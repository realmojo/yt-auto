import { spawn } from "node:child_process";
import { mkdir, writeFile, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { refDir, slug } from "@/lib/shopping";

export type Selected = { source: "taobao" | "rednote"; id: string; videoRef: string };

/** 자식 프로세스 실행 + 로그 콜백. 종료코드 resolve. */
function run(cmd: string, args: string[], onLog: (l: string) => void): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: process.cwd(), env: process.env });
    let last = "";
    const onChunk = (d: Buffer) => {
      for (const seg of d.toString().split(/\r?\n|\r/)) {
        const line = seg.trim();
        if (line && line !== last) {
          last = line;
          onLog(line);
        }
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", (e) => {
      onLog(`오류: ${e.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * 선택한 항목들(순서 유지)의 원본 영상을 refs/<slug>/clips/ 에 다운로드.
 * 이미 받아둔 건 재사용. 타오바오는 직접 URL 배치 다운로드, 샤오홍수는 노트별 다운로드.
 * 반환: 존재하는 클립의 프로젝트 루트 기준 경로 배열(선택 순서).
 */
export async function downloadSelectedClips(
  keyword: string,
  selected: Selected[],
  onLog: (l: string) => void,
): Promise<string[]> {
  const dir = refDir(keyword);
  const s = slug(keyword);
  const clipsDir = join(dir, "clips");
  await mkdir(clipsDir, { recursive: true });

  const items = selected.map((sel, i) => {
    const nn = String(i + 1).padStart(2, "0");
    const fname = `${nn}_${sel.source}_${sel.id}.mp4`;
    return { ...sel, abs: join(clipsDir, fname), rel: `shopping/refs/${s}/clips/${fname}` };
  });

  // 타오바오: 직접 URL 배치 다운로드(브라우저 컨텍스트 재사용)
  const tb = items.filter((it) => it.source === "taobao" && !existsSync(it.abs));
  if (tb.length) {
    const listPath = join(clipsDir, "_taobao_dl.json");
    await writeFile(listPath, JSON.stringify(tb.map((it) => ({ url: it.videoRef, dest: it.abs, id: it.id }))));
    onLog(`⬇️ 타오바오 ${tb.length}개 다운로드…`);
    await run("node", ["scripts/taobao-videos.mjs", "--download-list", listPath], (l) => onLog(`[타오바오] ${l}`));
    await rm(listPath, { force: true }).catch(() => {});
  }

  // 샤오홍수: 노트별로 열어 원본 영상 다운로드
  const rn = items.filter((it) => it.source === "rednote" && !existsSync(it.abs));
  for (const it of rn) {
    onLog(`⬇️ 샤오홍수 ${it.id} 다운로드…`);
    await run(
      "node",
      ["shopping/rednote-fetch.js", "--download-note", it.videoRef, "--dest", it.abs],
      (l) => onLog(`[샤오홍수] ${l}`),
    );
  }

  // 순서대로 존재/유효한 것만 수집
  const out: string[] = [];
  for (const it of items) {
    if (existsSync(it.abs)) {
      try {
        if ((await stat(it.abs)).size > 1000) out.push(it.rel);
        else onLog(`⚠️ 빈 파일: ${it.source} ${it.id}`);
      } catch {
        /* skip */
      }
    } else {
      onLog(`⚠️ 다운로드 실패(건너뜀): ${it.source} ${it.id}`);
    }
  }
  return out;
}

/** desub.py 를 실행할 파이썬 — 전용 venv(shopping/.venv-desub) 우선, 없으면 python3. */
function desubPython(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const venv = join(process.cwd(), "shopping", ".venv-desub", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

/** desub 실행 가능 여부(ocrbox 바이너리 + iopaint) 사전 점검. */
async function desubReady(onLog: (l: string) => void): Promise<boolean> {
  const ocrbox = join(process.cwd(), "shopping", "ocrbox");
  if (!existsSync(ocrbox)) {
    onLog("⚠️ 자막 제거 건너뜀 — shopping/ocrbox 없음 (npm run desub:setup 필요)");
    return false;
  }
  const code = await new Promise<number>((resolve) => {
    const c = spawn(desubPython(), ["-c", "import iopaint"], { cwd: process.cwd(), env: process.env });
    c.on("error", () => resolve(1));
    c.on("close", (x) => resolve(x ?? 1));
  });
  if (code !== 0) {
    onLog("⚠️ 자막 제거 건너뜀 — iopaint 미설치 (npm run desub:setup 필요)");
    return false;
  }
  return true;
}

/**
 * 각 클립의 번인(하드코딩) 자막을 shopping/desub.py(Apple Vision OCR + LaMa 인페인팅)로 제거.
 * 결과는 같은 폴더에 clean_<이름>.mp4 로 캐시. 실패/미설치 시 원본 경로로 폴백.
 * 반환: 정제본(또는 원본) 프로젝트 루트 기준 경로 배열(입력 순서 유지).
 */
export async function cleanSubtitles(
  clips: string[],
  onLog: (l: string) => void,
): Promise<string[]> {
  if (!clips.length) return clips;
  if (!(await desubReady(onLog))) return clips; // 전부 원본 사용
  const python = desubPython();
  const out: string[] = [];
  for (const rel of clips) {
    const abs = join(process.cwd(), rel);
    const cleanAbs = join(dirname(abs), `clean_${basename(abs)}`);
    const cleanRel = join(dirname(rel), `clean_${basename(rel)}`);
    // 캐시 재사용
    if (existsSync(cleanAbs)) {
      try {
        if ((await stat(cleanAbs)).size > 1000) {
          onLog(`✓ 자막제거 캐시: ${basename(abs)}`);
          out.push(cleanRel);
          continue;
        }
      } catch {
        /* 다시 생성 */
      }
    }
    onLog(`🧹 자막 제거: ${basename(abs)}`);
    const code = await run(python, ["shopping/desub.py", abs, cleanAbs], (l) => onLog(`[desub] ${l}`));
    let ok = false;
    if (code === 0 && existsSync(cleanAbs)) {
      try {
        ok = (await stat(cleanAbs)).size > 1000;
      } catch {
        ok = false;
      }
    }
    if (ok) out.push(cleanRel);
    else {
      onLog(`⚠️ 자막 제거 실패 — 원본 사용: ${basename(abs)}`);
      out.push(rel);
    }
  }
  return out;
}
