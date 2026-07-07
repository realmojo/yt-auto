import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { refDir } from "@/lib/shopping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = {
  source: "rednote" | "taobao";
  key: string; // 고유키 `${source}:${id}`
  id: string;
  title: string;
  cover: string; // 프록시 커버 URL(없으면 "")
  streamUrl: string; // 갤러리 재생용 스트리밍 프록시 URL(직접 영상URL 있을 때만)
  videoRef: string; // 생성 시 다운로드용 — taobao: 영상URL, rednote: 노트(xsec)URL
  downloaded: boolean; // clips/ 에 이미 받아둔 게 있는지
};

const proxied = (u: string, src: string) =>
  u ? `/api/shopping/cover?u=${encodeURIComponent(u)}&src=${src}` : "";
const streamed = (u: string, src: string) =>
  u ? `/api/shopping/stream?u=${encodeURIComponent(u)}&src=${src}` : "";

/**
 * 검색으로 수집(다운로드X)한 항목 메타를 반환.
 *  - videos: 샤오홍수(RedNote) 노트  - taobao: 타오바오 상품
 * 각 항목은 커버(프록시)와 videoRef(생성 시 다운로드용)를 갖는다.
 */
export async function GET(req: NextRequest) {
  const keyword = new URL(req.url).searchParams.get("keyword")?.trim();
  if (!keyword) return NextResponse.json({ videos: [], taobao: [] });

  const dir = refDir(keyword);
  const clipNames = (await readdir(join(dir, "clips")).catch(() => [])) as string[];
  const isDownloaded = (source: string, id: string) =>
    clipNames.some((f) => f.endsWith(`_${source}_${id}.mp4`));

  // ---- 샤오홍수 (index.json 의 notes) ----
  const videos: Item[] = [];
  try {
    const idx = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
    for (const n of (idx.notes || []).filter((x: { isVideo?: boolean }) => x.isVideo !== false)) {
      if (!n.id) continue;
      videos.push({
        source: "rednote",
        key: `rednote:${n.id}`,
        id: n.id,
        title: (n.title || "").trim(),
        cover: proxied(n.cover || "", "rednote"),
        streamUrl: streamed(n.videoUrl || "", "rednote"),
        videoRef: n.xsecUrl || n.url || "",
        downloaded: isDownloaded("rednote", n.id),
      });
    }
  } catch {
    /* 없으면 빈 배열 */
  }

  // ---- 타오바오 (taobao/index.json 의 items) ----
  const taobao: Item[] = [];
  try {
    const tIdx = JSON.parse(await readFile(join(dir, "taobao", "index.json"), "utf8"));
    for (const it of tIdx.items || []) {
      if (!it.id || !it.videoUrl) continue;
      taobao.push({
        source: "taobao",
        key: `taobao:${it.id}`,
        id: it.id,
        title: (it.title || "").trim(),
        cover: proxied(it.cover || "", "taobao"),
        streamUrl: streamed(it.videoUrl, "taobao"),
        videoRef: it.videoUrl,
        downloaded: isDownloaded("taobao", it.id),
      });
    }
  } catch {
    /* 없으면 빈 배열 */
  }

  return NextResponse.json({ videos, taobao });
}
