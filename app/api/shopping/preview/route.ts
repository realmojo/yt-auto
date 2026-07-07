import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { refDir } from "@/lib/shopping";
import { downloadSelectedClips, Selected } from "@/lib/shopping-clips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * ① 대본 생성 — 선택한 영상들을 (필요분만) 다운로드해 5초씩 몽타주 프레임으로 삼아
 * 후킹→문제→전환→기능→마무리 구조의 40~60초 대본을 생성한다(렌더 X, --dry-script).
 * body: { keyword, selected: [{source,id,videoRef}] }
 * 이벤트: {type:"log", line} / {type:"done", script} / {type:"error", message}
 */
export async function POST(req: NextRequest) {
  const { keyword, selected } = await req.json();
  const kw = String(keyword || "").trim();
  if (!kw) return new Response("keyword 필요", { status: 400 });
  const sel: Selected[] = Array.isArray(selected) ? selected : [];
  if (!sel.length) return new Response("선택한 영상이 없습니다", { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (o: unknown) => {
        if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      };
      const log = (line: string) => send({ type: "log", line });
      const fail = (message: string) => {
        send({ type: "error", message });
        closed = true;
        controller.close();
      };

      (async () => {
        try {
          log(`▶ 선택 ${sel.length}개 · 대본 생성 준비`);
          const clips = await downloadSelectedClips(kw, sel, log);
          if (!clips.length) return fail("영상을 하나도 받지 못했습니다. 로그인/선택을 확인하세요.");
          log(`✓ 클립 ${clips.length}개 준비 — 대본 생성 시작`);

          const args = [
            "shopping/make-short.mjs",
            "--keyword", kw,
            "--clips", clips.join(","),
            "--dry-script",
          ];
          const child = spawn("node", args, { cwd: process.cwd(), env: process.env });
          let last = "";
          const onChunk = (d: Buffer) => {
            for (const seg of d.toString().split(/\r?\n|\r/)) {
              const line = seg.trim();
              if (line && line !== last) {
                last = line;
                log(line);
              }
            }
          };
          child.stdout.on("data", onChunk);
          child.stderr.on("data", onChunk);
          child.on("error", (e) => fail(e.message));
          child.on("close", async (code) => {
            if (code === 0) {
              try {
                const script = JSON.parse(await readFile(join(refDir(kw), "script.json"), "utf8"));
                send({ type: "done", script });
                closed = true;
                controller.close();
              } catch (e) {
                fail(`대본 파일을 읽지 못했습니다: ${(e as Error).message}`);
              }
            } else {
              fail(`대본 생성 실패 (exit ${code}). API 키가 없으면 자막만 모드로 진행하세요.`);
            }
          });
        } catch (e) {
          fail((e as Error).message);
        }
      })();
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
