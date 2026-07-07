import { NextRequest } from "next/server";
import { spawn, ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { slug, refDir } from "@/lib/shopping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * 통합 검색: 하나의 키워드로 샤오홍수(RedNote)와 타오바오에서 각각 영상을 수집·다운로드.
 *  - 샤오홍수: shopping/rednote-fetch.js  → refs/<slug>/videos + index.json
 *  - 타오바오: scripts/taobao-videos.mjs  → refs/<slug>/taobao + index.json
 * body: { keyword, limit? }  → SSE: {type:"log", source} / {type:"done"} / {type:"error"}
 * ⚠️ 최초 1회 각각 로그인 필요: `npm run rednote:login`, `node scripts/taobao-videos.mjs --login`
 */
export async function POST(req: NextRequest) {
  const { keyword, limit } = await req.json();
  const kw = String(keyword || "").trim();
  if (!kw) return new Response("keyword 필요", { status: 400 });
  const n = Math.min(Math.max(parseInt(String(limit ?? 7), 10) || 7, 1), 20);
  const s = slug(kw);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (o: unknown) => {
        if (!closed) controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      };
      const end = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      send({ type: "log", source: "sys", line: `▶ "${kw}" — 샤오홍수 ${n}개 · 타오바오 ${n}개 수집 시작` });

      // 새 검색은 그 키워드의 기존 메타 캐시를 비우고 시작(진짜 새로고침).
      // 한쪽 소스가 실패해도 옛 결과가 남지 않도록 미리 지운다(clips 다운로드본은 유지).
      try {
        const dir = refDir(kw);
        rmSync(join(dir, "index.json"), { force: true });
        rmSync(join(dir, "taobao", "index.json"), { force: true });
      } catch {
        /* 없으면 무시 */
      }

      // 수집만(다운로드 X) — 실제 mp4 다운로드는 "쇼츠 생성" 때 선택분만 진행
      const jobs: { name: string; source: string; args: [string, string[]] }[] = [
        {
          name: "샤오홍수",
          source: "rednote",
          // --resolve: 다운로드 없이 영상 URL만 얻어와 갤러리에서 스트리밍 재생 가능하게
          args: ["node", ["shopping/rednote-fetch.js", "--keyword", kw, "--limit", String(n), "--resolve"]],
        },
        {
          name: "타오바오",
          source: "taobao",
          // --all: 검색 1페이지의 영상 상품을 전부 수집(개수 제한 없이)
          args: [
            "node",
            [
              "scripts/taobao-videos.mjs",
              "--search", kw, "--all", "--no-download",
              "--out", `shopping/refs/${s}/taobao`,
            ],
          ],
        },
      ];

      let remaining = jobs.length;
      const children: ChildProcess[] = [];
      const settle = () => {
        remaining -= 1;
        if (remaining <= 0) {
          send({ type: "done" });
          end();
        }
      };

      for (const job of jobs) {
        const [cmd, args] = job.args;
        const child = spawn(cmd, args, { cwd: process.cwd(), env: process.env });
        children.push(child);
        let last = "";
        const onChunk = (d: Buffer) => {
          for (const seg of d.toString().split(/\r?\n|\r/)) {
            const line = seg.trim();
            if (line && line !== last) {
              last = line;
              send({ type: "log", source: job.source, line: `[${job.name}] ${line}` });
            }
          }
        };
        child.stdout?.on("data", onChunk);
        child.stderr?.on("data", onChunk);
        child.on("error", (e) => {
          send({ type: "log", source: job.source, line: `[${job.name}] 실행 오류: ${e.message}` });
          settle();
        });
        child.on("close", (code) => {
          if (code === 0) send({ type: "log", source: job.source, line: `[${job.name}] ✅ 완료` });
          else
            send({
              type: "log",
              source: job.source,
              line: `[${job.name}] ⚠️ 실패(exit ${code}). 로그인이 안 돼 있으면 터미널에서 로그인을 먼저 하세요.`,
            });
          settle();
        });
      }

      // 클라이언트가 끊으면 자식 프로세스 정리
      req.signal.addEventListener("abort", () => {
        for (const c of children) c.kill();
        end();
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
