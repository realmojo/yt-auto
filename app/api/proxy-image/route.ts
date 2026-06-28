/**
 * 원격 이미지 프록시.
 *
 * 편집기 캔버스는 export 시 `canvas.captureStream()` 으로 녹화하는데,
 * 교차 출처(remote) 이미지를 직접 그리면 캔버스가 "tainted" 되어 녹화가 실패한다.
 * 이 라우트로 서버에서 받아 **같은 출처**로 다시 내려주면 taint 가 발생하지 않는다.
 */

const BLOCKED_HOST =
  /^(localhost$|127\.|0\.0\.0\.0$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|\[?::1)/i;

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) return new Response("missing url", { status: 400 });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return new Response("unsupported protocol", { status: 400 });
  }
  if (BLOCKED_HOST.test(target.hostname)) {
    return new Response("blocked host", { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "image/*,*/*;q=0.8",
      },
      // 리다이렉트(ggpht 등)는 따라간다
      redirect: "follow",
    });
    if (!upstream.ok) {
      return new Response(`upstream ${upstream.status}`, { status: 502 });
    }
    const ct = upstream.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) {
      return new Response("not an image", { status: 415 });
    }
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
}
