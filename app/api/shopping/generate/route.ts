import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { downloadSelectedClips, cleanSubtitles, Selected } from "@/lib/shopping-clips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * ② 쇼츠 생성 — 선택한 영상들(순서 유지)을 각 5초로 이어붙인 몽타주 배경 위에
 * 대본 자막을 얹고, 내레이션은 (있으면) 업로드한 음성으로, 없으면 TTS 로 렌더한다.
 * body: { keyword, selected:[{source,id,videoRef}], voice?, skipScript?, audioPath?, cleanSubs? }
 * 이벤트: {type:"log", line} / {type:"done", url} / {type:"error", message}
 */
export async function POST(req: NextRequest) {
  const { keyword, selected, voice, skipScript, audioPath, cleanSubs } = await req.json();
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
          log(`▶ 선택 ${sel.length}개 · 쇼츠 생성 시작 (${sel.length * 5}초 목표)`);
          let clips = await downloadSelectedClips(kw, sel, log);
          if (!clips.length) return fail("영상을 하나도 받지 못했습니다. 로그인/선택을 확인하세요.");

          // 원본 번인 자막 자동 제거(기본 ON) — desub.py(OCR + LaMa). 미설치/실패 시 원본 사용.
          if (cleanSubs !== false) {
            log("🧹 원본 자막 제거 중… (첫 실행은 시간이 걸릴 수 있어요)");
            clips = await cleanSubtitles(clips, log);
          }
          log(`✓ 클립 ${clips.length}개 준비 — 렌더 시작`);

          const args = [
            "shopping/make-short.mjs",
            "--keyword", kw,
            "--clips", clips.join(","),
          ];
          if (voice) args.push("--voice", String(voice));
          if (skipScript) args.push("--skip-script");
          if (audioPath) args.push("--audio", String(audioPath)); // 업로드 음성(있으면 TTS 건너뜀)

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
          child.on("close", (code) => {
            if (code === 0) {
              send({
                type: "done",
                url: `/api/shopping/file?keyword=${encodeURIComponent(kw)}&name=short.mp4&t=${Date.now()}`,
              });
              closed = true;
              controller.close();
            } else {
              fail(`생성 실패 (exit ${code})`);
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
