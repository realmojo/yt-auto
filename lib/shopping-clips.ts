import { spawn } from "node:child_process";
import { mkdir, writeFile, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
