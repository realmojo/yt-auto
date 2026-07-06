import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { refDir } from "@/lib/shopping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 렌더 전 미리보기용 — make-short.mjs 를 --dry-script 로 실행해 대본만 생성한다.
 * (선택한 레퍼런스 영상의 키프레임을 근거로 Claude 가 장면별 자막/내레이션 대본 작성)
 * body: { keyword, videoPath?, imagePath? }
 * 이벤트: {type:"log", line} / {type:"done", script} / {type:"error", message}
 */
export async function POST(req: NextRequest) {
  const { keyword, videoPath, imagePath } = await req.json();
  if (!keyword) return new Response("keyword 필요", { status: 400 });

  const args = ["shopping/make-short.mjs", "--keyword", String(keyword), "--dry-script"];
  if (videoPath) args.push("--video", String(videoPath));
  else if (imagePath) args.push("--image", String(imagePath));

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      send({ type: "log", line: `▶ 대본 생성: ${keyword}` });

      const child = spawn("node", args, { cwd: process.cwd(), env: process.env });
      let last = "";
      const onChunk = (d: Buffer) => {
        for (const seg of d.toString().split(/\r?\n|\r/)) {
          const line = seg.trim();
          if (line && line !== last) {
            last = line;
            send({ type: "log", line });
          }
        }
      };
      child.stdout.on("data", onChunk);
      child.stderr.on("data", onChunk);
      child.on("error", (e) => {
        send({ type: "error", message: e.message });
        closed = true;
        controller.close();
      });
      child.on("close", async (code) => {
        if (code === 0) {
          try {
            const script = JSON.parse(
              await readFile(join(refDir(String(keyword)), "script.json"), "utf8"),
            );
            send({ type: "done", script });
          } catch (e) {
            send({ type: "error", message: `대본 파일을 읽지 못했습니다: ${(e as Error).message}` });
          }
        } else {
          send({ type: "error", message: `대본 생성 실패 (exit ${code})` });
        }
        closed = true;
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
