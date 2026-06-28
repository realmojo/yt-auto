import { NextRequest, NextResponse } from "next/server";
import {
  CATEGORIES,
  fetchSectionNews,
  normalizeSid,
} from "@/lib/naver-news";

// 매 요청마다 최신 뉴스를 가져온다 (캐시 비활성화)
export const dynamic = "force-dynamic";

/**
 * GET /api/news?count=100&sid=101
 *
 * 네이버 뉴스 섹션을 수집해 JSON 으로 반환한다. (기본: 경제)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const count = Math.min(Math.max(Number(params.get("count")) || 100, 1), 300);
  const sid = normalizeSid(params.get("sid"));
  const category =
    CATEGORIES.find((c) => c.sid === sid)?.label ?? "경제";

  try {
    const items = await fetchSectionNews(sid, count, {
      signal: request.signal,
    });
    return NextResponse.json({
      ok: true,
      sid,
      category,
      count: items.length,
      items,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
