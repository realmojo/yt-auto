import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir, homedir, cpus } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 긴 영상 전사 대비

const exec = promisify(execFile);

/** 환경에서 ffmpeg / whisper.cpp 바이너리·모델 경로를 해석 */
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";

const WHISPER_BIN_CANDIDATES = [
  process.env.WHISPER_BIN,
  "/opt/homebrew/bin/whisper-cli",
  "/opt/homebrew/bin/whisper-cpp",
  "/usr/local/bin/whisper-cli",
  "whisper-cli",
].filter(Boolean) as string[];

const WHISPER_MODEL_CANDIDATES = [
  process.env.WHISPER_MODEL,
  join(homedir(), ".cache/whisper/ggml-small.bin"),
  join(homedir(), ".cache/whisper/ggml-base.bin"),
  "/opt/homebrew/share/whisper-cpp/ggml-small.bin",
].filter(Boolean) as string[];

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    if (p.includes("/")) {
      try {
        await access(p);
        return p;
      } catch {
        /* 다음 후보 */
      }
    } else {
      // PATH 상의 이름 — 존재 검사를 생략하고 그대로 시도
      return p;
    }
  }
  return null;
}

interface WhisperSegment {
  offsets: { from: number; to: number }; // ms
  text: string;
}

export async function POST(req: NextRequest) {
  const bin = await firstExisting(WHISPER_BIN_CANDIDATES);
  const model = await firstExisting(WHISPER_MODEL_CANDIDATES);
  if (!bin) {
    return NextResponse.json(
      {
        error:
          "whisper.cpp 바이너리를 찾을 수 없습니다. `brew install whisper-cpp` 후 다시 시도하거나 WHISPER_BIN 환경변수를 지정하세요.",
      },
      { status: 500 },
    );
  }
  if (!model) {
    return NextResponse.json(
      {
        error:
          "whisper 모델 파일이 없습니다. ggml-*.bin 모델을 받아 ~/.cache/whisper/ 에 두거나 WHISPER_MODEL 환경변수로 경로를 지정하세요.",
      },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const lang = (form.get("lang") as string) || "ko";
  // 자막 한 줄 최대 글자수(0=제한없음). 짧을수록 자막 줄이 잘게 나뉜다.
  const maxLen = String(Math.max(0, Number(form.get("maxLen")) || 25));
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file 필드(오디오/비디오)가 필요합니다." }, { status: 400 });
  }

  const dir = await mkdtemp(join(tmpdir(), "ytstt-"));
  const inputPath = join(dir, "input");
  const wavPath = join(dir, "audio.wav");
  const outBase = join(dir, "out");

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buf);

    // 1) ffmpeg: 16kHz mono PCM wav 로 추출 (whisper.cpp 권장 포맷)
    await exec(
      FFMPEG,
      ["-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", wavPath],
      { maxBuffer: 1024 * 1024 * 64 },
    );

    // 2) whisper.cpp: 세그먼트 타임스탬프 JSON 출력
    await exec(
      bin,
      [
        "-m", model,
        "-f", wavPath,
        "-l", lang,
        "-oj", // out JSON
        "-of", outBase,
        "-ml", maxLen, // 자막 줄당 최대 글자수
        "-sow", "true", // 단어 경계에서 분할
        "-t", String(Math.max(1, (cpus()?.length ?? 4) - 1)),
      ],
      { maxBuffer: 1024 * 1024 * 64 },
    );

    const raw = await readFile(`${outBase}.json`, "utf8");
    const parsed = JSON.parse(raw) as { transcription?: WhisperSegment[]; result?: { language?: string } };
    const segments = (parsed.transcription ?? [])
      .map((s) => ({
        start: (s.offsets?.from ?? 0) / 1000,
        end: (s.offsets?.to ?? 0) / 1000,
        text: (s.text ?? "").trim(),
      }))
      .filter((s) => s.text.length > 0 && s.end > s.start);

    return NextResponse.json({
      segments,
      count: segments.length,
      language: parsed.result?.language ?? lang,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `전사 실패: ${message.slice(0, 500)}` },
      { status: 500 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
