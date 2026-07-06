import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { refDir, slug } from "@/lib/shopping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;
const UPLOAD_RE = /^_upload\.(mp4|mov|webm|mkv)$/i;

type Item = {
  name: string;
  path: string; // 프로젝트 루트 기준 경로(make-short --video 로 그대로 전달)
  src: string; // 미리보기 재생용(file 라우트)
  title: string;
  author: string;
  likes: string;
  cover: string;
  uploaded: boolean;
};

/**
 * 키워드 폴더에 받아둔 레퍼런스 영상 목록 + 메타(index.json)를 반환.
 * 사용자가 쇼츠 배경으로 쓸 영상을 직접 고를 수 있게 UI 에 뿌린다.
 */
export async function GET(req: NextRequest) {
  const keyword = new URL(req.url).searchParams.get("keyword")?.trim();
  if (!keyword) return NextResponse.json({ videos: [] });

  const dir = refDir(keyword);
  const s = slug(keyword);
  const src = (name: string, sub?: string) =>
    `/api/shopping/file?keyword=${encodeURIComponent(keyword)}${sub ? `&sub=${sub}` : ""}&name=${encodeURIComponent(name)}`;

  // index.json 의 노트 메타를 파일명으로 매핑(제목/작성자/좋아요/커버)
  const meta: Record<string, { title?: string; author?: string; likes?: string; cover?: string }> = {};
  try {
    const idx = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
    for (const n of idx.notes || []) {
      if (n.videoFile) meta[basename(n.videoFile)] = n;
    }
  } catch {
    /* index.json 없으면 메타 없이 진행 */
  }

  const out: Item[] = [];

  // 1) 샤오홍수에서 받은 레퍼런스 영상들
  const vids = (await readdir(join(dir, "videos")).catch(() => []))
    .filter((f) => VIDEO_EXT.test(f))
    .sort();
  for (const f of vids) {
    const m = meta[f] || {};
    out.push({
      name: f,
      path: `shopping/refs/${s}/videos/${f}`,
      src: src(f, "videos"),
      title: (m.title || "").trim(),
      author: (m.author || "").trim(),
      likes: (m.likes || "").trim(),
      cover: (m.cover || "").trim(),
      uploaded: false,
    });
  }

  // 2) 직접 업로드한 영상(_upload.*)이 있으면 함께 노출
  const up = (await readdir(dir).catch(() => [])).find((f) => UPLOAD_RE.test(f));
  if (up) {
    out.push({
      name: up,
      path: `shopping/refs/${s}/${up}`,
      src: src(up),
      title: "직접 업로드",
      author: "",
      likes: "",
      cover: "",
      uploaded: true,
    });
  }

  return NextResponse.json({ videos: out });
}
