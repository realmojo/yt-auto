import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { refDir } from "@/lib/shopping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;
const IMG_EXT = /\.(jpe?g|png|webp|gif)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;

/** 레퍼런스 영상/상품 이미지/직접 만든 내레이션을 refs/<키워드>/ 에 저장한다. */
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
  const isAudio = !isVideo && (AUDIO_EXT.test(name) || type.startsWith("audio"));
  const isImage = !isVideo && !isAudio && (IMG_EXT.test(name) || type.startsWith("image"));
  if (!isVideo && !isAudio && !isImage) {
    return NextResponse.json({ error: "영상·오디오·이미지 파일만 가능" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // 업로드본은 고정 이름으로 저장하고 생성 시 --video/--audio/--image 로 명시 지정
  const ext = extname(name).toLowerCase() || (isVideo ? ".mp4" : isAudio ? ".mp3" : ".jpg");
  const dest = isVideo
    ? join(dir, `_upload${ext}`)
    : isAudio
      ? join(dir, `_narration${ext}`)
      : join(dir, `input${ext}`);
  await writeFile(dest, buf);

  return NextResponse.json({
    ok: true,
    kind: isVideo ? "video" : isAudio ? "audio" : "image",
    path: `shopping/refs/${basename(dir)}/${basename(dest)}`,
    name: basename(dest),
  });
}
