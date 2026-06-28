import { NextRequest, NextResponse } from "next/server";

import {
  countryByCode,
  isLocalScript,
  isOfficialLike,
  parseISODuration,
  type ShortVideo,
} from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const YT = "https://www.googleapis.com/youtube/v3";
const MAX_SHORT_SEC = 180; // 쇼츠 최대 길이(현 유튜브 기준 3분)
const CACHE_TTL = 10 * 60 * 1000; // 10분

interface CacheEntry {
  ts: number;
  items: ShortVideo[];
}
const cache = new Map<string, CacheEntry>();

interface SearchItem {
  id?: { videoId?: string };
}
interface VideoItem {
  id: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
}

export async function GET(req: NextRequest) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return NextResponse.json(
      {
        error:
          "YouTube API 키가 없습니다. Google Cloud Console에서 YouTube Data API v3 키를 발급받아 .env.local 에 YOUTUBE_API_KEY 로 추가하세요.",
        needKey: true,
      },
      { status: 503 },
    );
  }

  const region = (req.nextUrl.searchParams.get("region") || "KR").toUpperCase();
  const country = countryByCode(region);
  if (!country) {
    return NextResponse.json({ error: "지원하지 않는 국가 코드입니다." }, { status: 400 });
  }
  const refresh = req.nextUrl.searchParams.get("refresh");

  const cached = cache.get(region);
  if (cached && !refresh && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ region, count: cached.items.length, items: cached.items, cached: true });
  }

  try {
    // 최근 7일, 현지어 "쇼츠" 검색 + 조회수순 → 그 나라에서 지금 뜨는 "실제 크리에이터 쇼츠"
    // (chart=mostPopular 은 예고편·뮤직 등 공식 콘텐츠 위주라 재가공용으로 부적합)
    const publishedAfter = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const searchUrl =
      `${YT}/search?part=snippet&type=video&videoDuration=short&order=viewCount` +
      `&q=${encodeURIComponent(country.q)}&regionCode=${region}&relevanceLanguage=${country.lang}` +
      `&publishedAfter=${encodeURIComponent(publishedAfter)}&maxResults=50&key=${key}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    if (!searchRes.ok) {
      const reason = searchData?.error?.message || `검색 실패 (HTTP ${searchRes.status})`;
      return NextResponse.json({ error: `YouTube API 오류: ${reason}` }, { status: 502 });
    }
    const ids = (searchData.items as SearchItem[])
      .map((it) => it.id?.videoId)
      .filter((v): v is string => Boolean(v));
    if (ids.length === 0) {
      cache.set(region, { ts: Date.now(), items: [] });
      return NextResponse.json({ region, count: 0, items: [] });
    }

    const videosRes = await fetch(
      `${YT}/videos?part=snippet,contentDetails,statistics&id=${ids.join(",")}&maxResults=50&key=${key}`,
    );
    const videosData = await videosRes.json();
    if (!videosRes.ok) {
      const reason = videosData?.error?.message || `상세 조회 실패 (HTTP ${videosRes.status})`;
      return NextResponse.json({ error: `YouTube API 오류: ${reason}` }, { status: 502 });
    }

    const items: ShortVideo[] = (videosData.items as VideoItem[])
      .map((v): ShortVideo => {
        const t = v.snippet?.thumbnails ?? {};
        const thumb = t.maxres?.url || t.standard?.url || t.high?.url || t.medium?.url || t.default?.url || "";
        return {
          id: v.id,
          title: v.snippet?.title ?? "",
          channelTitle: v.snippet?.channelTitle ?? "",
          channelId: v.snippet?.channelId ?? "",
          thumbnail: thumb,
          views: Number(v.statistics?.viewCount ?? 0),
          likes: Number(v.statistics?.likeCount ?? 0),
          durationSec: parseISODuration(v.contentDetails?.duration ?? ""),
          publishedAt: v.snippet?.publishedAt ?? "",
          url: `https://www.youtube.com/shorts/${v.id}`,
        };
      })
      .filter((v) => v.durationSec > 0 && v.durationSec <= MAX_SHORT_SEC)
      // 공식 예고편·뮤직비디오 등(재가공 부적합) 제외
      .filter((v) => !isOfficialLike(v.channelTitle, v.title))
      // 현지 문자(한글/가나 등) 쇼츠를 먼저, 그다음 조회수순 → 글로벌 바이럴이 국가 탭을 덮는 것 완화
      .sort((a, b) => {
        const la = isLocalScript(`${a.title} ${a.channelTitle}`, country.lang) ? 1 : 0;
        const lb = isLocalScript(`${b.title} ${b.channelTitle}`, country.lang) ? 1 : 0;
        return lb - la || b.views - a.views;
      });

    cache.set(region, { ts: Date.now(), items });
    return NextResponse.json({ region, count: items.length, items });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `쇼츠를 불러오지 못했습니다: ${message.slice(0, 300)}` }, { status: 500 });
  }
}
