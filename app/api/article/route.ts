import { NextRequest, NextResponse } from "next/server";
import { fetchArticleBody } from "@/lib/naver-news";

export const dynamic = "force-dynamic";

/**
 * GET /api/article?url=https://n.news.naver.com/mnews/article/...
 *
 * 네이버 뉴스 기사 본문을 추출해 반환한다.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "url 파라미터가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const article = await fetchArticleBody(url, request.signal);
    return NextResponse.json({ ok: true, ...article });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
