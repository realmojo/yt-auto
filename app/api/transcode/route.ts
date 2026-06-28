/**
 * 녹화된 영상(webm 등)을 ffmpeg 로 mp4(H.264 + AAC)로 변환한다.
 * 대부분의 Chrome 은 MediaRecorder 로 webm 만 만들 수 있어, 여기서 mp4 로 바꾼다.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const runtime = "nodejs";
export const maxDuration = 600;

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const from =
    (url.searchParams.get("from") || "webm").replace(/[^a-z0-9]/gi, "") ||
    "webm";

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) {
    return new Response("empty body", { status: 400 });
  }

  const dir = await mkdtemp(join(tmpdir(), "yt-export-"));
  const input = join(dir, `in.${from}`);
  const output = join(dir, "out.mp4");

  try {
    await writeFile(input, buf);
    await runFfmpeg([
      "-y",
      "-i",
      input,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2", // 홀수 해상도 보호
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      output,
    ]);
    const out = await readFile(output);
    return new Response(new Uint8Array(out), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(out.length),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "transcode failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d: Buffer) => {
      err += d.toString();
      if (err.length > 8000) err = err.slice(-8000);
    });
    proc.on("error", (e) =>
      reject(
        e.message.includes("ENOENT")
          ? new Error("ffmpeg 가 설치되어 있지 않습니다 (brew install ffmpeg)")
          : e,
      ),
    );
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            err.trim().split("\n").slice(-2).join(" ") || `ffmpeg exit ${code}`,
          ),
        );
    });
  });
}
