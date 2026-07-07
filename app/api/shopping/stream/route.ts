import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

/**
 * 원격 영상 스트리밍 프록시 — 타오바오(cloud.video.taobao.com)/샤오홍수(rednotecdn) 영상을
 * referer 를 붙여 대신 스트리밍(핫링크 회피). Range 를 그대로 전달해 브라우저 시킹 지원.
 * 디스크에 저장하지 않고 재생만(실제 다운로드는 "쇼츠 생성" 때 선택분만).
 * query: u=<영상URL>  src=taobao|rednote
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const u = searchParams.get("u");
  const src = searchParams.get("src") || "";
  if (!u) return new Response("u 필요", { status: 400 });
  const url = u.startsWith("//") ? "https:" + u : u;
  if (!/^https?:\/\//i.test(url)) return new Response("잘못된 URL", { status: 400 });

  const referer = src === "rednote" ? "https://www.rednote.com/" : "https://s.taobao.com/";
  const range = req.headers.get("range");
  const headers: Record<string, string> = { referer, "user-agent": UA };
  if (range) headers["range"] = range;

  try {
    const upstream = await fetch(url, { headers });
    const h = new Headers();
    for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(k);
      if (v) h.set(k, v);
    }
    if (!h.has("content-type")) h.set("content-type", "video/mp4");
    if (!h.has("accept-ranges")) h.set("accept-ranges", "bytes");
    h.set("cache-control", "public, max-age=3600");
    return new Response(upstream.body, { status: upstream.status, headers: h });
  } catch (e) {
    return new Response(`스트림 실패: ${(e as Error).message}`, { status: 502 });
  }
}
