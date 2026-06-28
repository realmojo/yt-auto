import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const exec = promisify(execFile);
// macOS 내장 TTS. 비-macOS 환경에선 SAY_BIN 으로 다른 호환 바이너리를 지정.
const SAY = process.env.SAY_BIN || "/usr/bin/say";
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";

// 음성 이름은 여러 언어에 중복 존재(예: 영어 Grandpa와 한국어 Grandpa).
// 한국어 음성 데이터가 실제로 설치돼 있어야 say가 한국어를 발음한다(아니면 무음).
// → 각 후보를 짧게 합성해 파일 크기로 실제 동작 여부를 판별한다(무음 ≈ 4.8KB, 정상 > 40KB).
let cachedVoices: string[] | null = null;

/** 실제로 한국어를 발음하는 say 음성만 반환 (다운로드한 음성도 반영, 서버 프로세스 단위 캐시) */
export async function GET(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh");
  if (cachedVoices && !refresh) return NextResponse.json({ voices: cachedVoices });
  try {
    const { stdout } = await exec(SAY, ["-v", "?"], { maxBuffer: 1024 * 1024 * 4 });
    const names = [
      ...new Set(
        stdout
          .split("\n")
          .filter((l) => /\bko_KR\b/.test(l))
          .map((l) => {
            const m = l.match(/^(.+?)\s+[a-z]{2}_[A-Z]{2}\b/);
            return m ? m[1].replace(/\s*\(.*\)\s*$/, "").trim() : "";
          })
          .filter(Boolean),
      ),
    ];
    const dir = await mkdtemp(join(tmpdir(), "ytvoices-"));
    const working: string[] = [];
    try {
      for (const name of names) {
        const out = join(dir, `${name.replace(/[^\w]/g, "_")}.aiff`);
        try {
          await exec(SAY, ["-v", name, "-o", out, "테스트입니다"], {
            maxBuffer: 1024 * 1024,
          });
          if ((await stat(out)).size > 10000) working.push(name);
        } catch {
          /* 이 음성은 건너뜀 */
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    cachedVoices = working.length ? working : ["Yuna"];
    return NextResponse.json({ voices: cachedVoices });
  } catch {
    return NextResponse.json({ voices: ["Yuna"] });
  }
}

export async function POST(req: NextRequest) {
  let body: { text?: string; voice?: string; rate?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }
  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "음성으로 만들 텍스트가 필요합니다." }, { status: 400 });
  }
  const voice = (body.voice || "Yuna").replace(/[^\w가-힣 ]/g, "");
  const rate = body.rate && body.rate > 0 ? String(Math.round(body.rate)) : null;

  const dir = await mkdtemp(join(tmpdir(), "yttts-"));
  const txtPath = join(dir, "in.txt");
  const aiffPath = join(dir, "out.aiff");
  const mp3Path = join(dir, "out.mp3");

  try {
    // 텍스트는 파일로 전달 → 긴 대본·특수문자·줄바꿈 안전
    await writeFile(txtPath, text, "utf8");

    const sayArgs = ["-v", voice, "-f", txtPath, "-o", aiffPath];
    if (rate) sayArgs.push("-r", rate);
    await exec(SAY, sayArgs, { maxBuffer: 1024 * 1024 * 32 });

    // aiff → mp3 (브라우저 호환·용량 절감)
    await exec(
      FFMPEG,
      ["-i", aiffPath, "-codec:a", "libmp3lame", "-q:a", "4", "-y", mp3Path],
      { maxBuffer: 1024 * 1024 * 32 },
    );

    const buf = await readFile(mp3Path);
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/ENOENT/.test(message) && message.toLowerCase().includes("say")) {
      return NextResponse.json(
        {
          error:
            "macOS의 `say` 명령을 찾을 수 없습니다. macOS에서 실행하거나 SAY_BIN 환경변수로 호환 TTS 바이너리를 지정하세요.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: `내레이션 생성 실패: ${message.slice(0, 400)}` },
      { status: 500 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
