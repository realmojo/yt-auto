import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const exec = promisify(execFile);
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";

/** 브라우저가 디코드 못 하는 영상(HEVC·10bit·AV1 등)을 H.264(yuv420p)로 변환해 반환 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file 필드가 필요합니다." }, { status: 400 });
  }

  const dir = await mkdtemp(join(tmpdir(), "ytvid-"));
  const input = join(dir, "input");
  const output = join(dir, "out.mp4");
  try {
    await writeFile(input, Buffer.from(await file.arrayBuffer()));
    await exec(
      FFMPEG,
      [
        "-i", input,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p", // 8bit 4:2:0 — 모든 브라우저 호환
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", output,
      ],
      { maxBuffer: 1024 * 1024 * 64 },
    );
    const buf = await readFile(output);
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `영상 변환 실패: ${message.slice(0, 300)}` },
      { status: 500 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
