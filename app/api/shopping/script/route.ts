import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { refDir } from "@/lib/shopping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Scene = { part: string; narration: string; caption: string };

/**
 * 직접 입력한 대본 텍스트를 script.json 으로 저장(자동생성 대신/수정용).
 * 한 줄 = 한 장면(자막). "자막 | 내레이션" 형식이면 자막/내레이션 분리.
 * body: { keyword, text }  → { script }
 */
export async function POST(req: NextRequest) {
  const { keyword, text } = await req.json();
  const kw = String(keyword || "").trim();
  if (!kw) return NextResponse.json({ error: "keyword 필요" }, { status: 400 });

  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return NextResponse.json({ error: "대본이 비었습니다" }, { status: 400 });

  const scenes: Scene[] = lines.map((l) => {
    const i = l.indexOf("|");
    if (i >= 0) {
      const cap = l.slice(0, i).trim();
      const nar = l.slice(i + 1).trim();
      return { part: "", caption: cap || nar, narration: nar || cap };
    }
    return { part: "", caption: l, narration: l };
  });

  const script = { title: "", scenes, cta: "", hashtags: [] as string[] };
  const dir = refDir(kw);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "script.json"), JSON.stringify(script, null, 2));

  return NextResponse.json({ ok: true, script });
}
