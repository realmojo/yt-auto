import { NextRequest, NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { refDir } from "@/lib/shopping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;
const IMG_EXT = /^input\.(jpe?g|png|webp|gif)$/i;

/** 키워드 폴더의 레퍼런스/대본/결과 보유 현황 */
export async function GET(req: NextRequest) {
  const keyword = new URL(req.url).searchParams.get("keyword")?.trim();
  if (!keyword) return NextResponse.json({ videos: 0, hasScript: false, hasShort: false, hasImage: false });

  const dir = refDir(keyword);
  const vids = (await readdir(join(dir, "videos")).catch(() => [])).filter((f) => VIDEO_EXT.test(f));
  const uploadVid = (await readdir(dir).catch(() => [])).some((f) => /^_upload\.(mp4|mov|webm|mkv)$/i.test(f));
  const files = await readdir(dir).catch(() => []);
  return NextResponse.json({
    videos: vids.length + (uploadVid ? 1 : 0),
    hasImage: files.some((f) => IMG_EXT.test(f)),
    hasScript: existsSync(join(dir, "script.json")),
    hasShort: existsSync(join(dir, "short.mp4")),
  });
}
