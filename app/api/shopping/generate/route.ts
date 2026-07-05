import { NextRequest } from "next/server";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * make-short.mjs 를 자식 프로세스로 실행하고 진행 로그를 SSE 로 흘려보낸다.
 * body: { keyword, voice?, skipScript?, videoPath?, imagePath? }
 * 이벤트: {type:"log", line} / {type:"done", url} / {type:"error", message}
 */
export async function POST(req: NextRequest) {
  const { keyword, voice, skipScript, videoPath, imagePath } = await req.json();
  if (!keyword) return new Response("keyword 필요", { status: 400 });

  const args = ["shopping/make-short.mjs", "--keyword", String(keyword)];
  if (voice) args.push("--voice", String(voice));
  if (skipScript) args.push("--skip-script");
  if (videoPath) args.push("--video", String(videoPath));
  else if (imagePath) args.push("--image", String(imagePath));

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      send({ type: "log", line: `▶ 시작: ${keyword}` });

      const child = spawn("node", args, { cwd: process.cwd(), env: process.env });
      let last = "";
      const onChunk = (d: Buffer) => {
        // 렌더 진행은 \r 로 갱신되므로 \r/\n 모두로 분리
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
      child.on("close", (code) => {
        if (code === 0) {
          send({
            type: "done",
            url: `/api/shopping/file?keyword=${encodeURIComponent(keyword)}&name=short.mp4&t=${Date.now()}`,
          });
        } else {
          send({ type: "error", message: `생성 실패 (exit ${code})` });
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
