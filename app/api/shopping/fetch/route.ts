import { NextRequest } from "next/server";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * 1단계: 샤오홍수(RedNote)에서 키워드 영상 수집·다운로드 (rednote-fetch.js).
 * body: { keyword, limit? }  → SSE: {type:"log"} / {type:"done", videos} / {type:"error"}
 * ⚠️ 최초 1회 `node shopping/rednote-fetch.js --login` 으로 세션이 저장돼 있어야 한다.
 */
export async function POST(req: NextRequest) {
  const { keyword, limit } = await req.json();
  if (!keyword) return new Response("keyword 필요", { status: 400 });

  const args = [
    "shopping/rednote-fetch.js",
    "--keyword", String(keyword),
    "--limit", String(limit || 6),
    "--download",
  ];

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (o: unknown) => {
        if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      };
      send({ type: "log", line: `▶ 레퍼런스 수집: ${keyword}` });

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
      child.on("close", (code) => {
        if (code === 0) send({ type: "done" });
        else
          send({
            type: "error",
            message: `수집 실패 (exit ${code}). 로그인이 안 돼 있으면 터미널에서 'npm run rednote:login' 을 먼저 실행하세요.`,
          });
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
