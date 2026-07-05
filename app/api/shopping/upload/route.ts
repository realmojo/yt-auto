import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { refDir } from "@/lib/shopping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;
const IMG_EXT = /\.(jpe?g|png|webp|gif)$/i;

/** 레퍼런스 영상/상품 이미지를 refs/<키워드>/ 에 저장한다. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const keyword = String(form.get("keyword") || "").trim();
  const file = form.get("file");
  if (!keyword) return NextResponse.json({ error: "keyword 필요" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "file 필요" }, { status: 400 });

  const dir = refDir(keyword);
  await mkdir(dir, { recursive: true });
  const name = file.name || "upload";
  const type = file.type || "";
  const isVideo = VIDEO_EXT.test(name) || type.startsWith("video");
  const isImage = IMG_EXT.test(name) || type.startsWith("image");
  if (!isVideo && !isImage) {
    return NextResponse.json({ error: "영상 또는 이미지 파일만 가능" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // 업로드본은 고정 이름으로 저장하고 생성 시 --video/--image 로 명시 지정
  const ext = extname(name).toLowerCase() || (isVideo ? ".mp4" : ".jpg");
  const dest = isVideo ? join(dir, `_upload${ext}`) : join(dir, `input${ext}`);
  await writeFile(dest, buf);

  return NextResponse.json({
    ok: true,
    kind: isVideo ? "video" : "image",
    path: `shopping/refs/${basename(dir)}/${basename(dest)}`,
    name: basename(dest),
  });
}
