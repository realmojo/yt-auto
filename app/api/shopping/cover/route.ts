import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 커버 썸네일 프록시 — 타오바오(alicdn)/샤오홍수(xhscdn) 이미지를 referer 를 붙여 대신 받아 서빙.
 * (핫링크 차단 회피용). 검색 시 영상은 안 받고 커버만 이걸로 보여준다.
 * query: u=<이미지URL>  src=taobao|rednote
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const u = searchParams.get("u");
  const src = searchParams.get("src") || "";
  if (!u) return new Response("u 필요", { status: 400 });

  let url = u;
  if (url.startsWith("//")) url = "https:" + url;
  if (!/^https?:\/\//i.test(url)) return new Response("잘못된 URL", { status: 400 });

  const referer = src === "rednote" ? "https://www.rednote.com/" : "https://s.taobao.com/";
  try {
    const r = await fetch(url, {
      headers: {
        referer,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      },
    });
    if (!r.ok) return new Response("이미지 없음", { status: 404 });
    const type = r.headers.get("content-type") || "image/jpeg";
    const buf = await r.arrayBuffer();
    return new Response(buf, {
      headers: { "content-type": type, "cache-control": "public, max-age=86400" },
    });
  } catch (e) {
    return new Response(`프록시 실패: ${(e as Error).message}`, { status: 502 });
  }
}
