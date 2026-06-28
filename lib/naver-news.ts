/**
 * 네이버 뉴스 "경제" 섹션 수집기
 *
 * 공식 API 키 없이 네이버 뉴스 섹션의 "기사 더보기" AJAX 엔드포인트
 * (SECTION_ARTICLE_LIST 템플릿)를 커서 기반으로 페이징하여 기사를 모은다.
 *
 * - 섹션 sid 101 = 경제
 * - 응답 HTML의 `data-cursor` 값(마지막 기사 시각)을 다음 요청의 `next` 로 넘긴다.
 * - `data-has-next="false"` 가 나오면 더 이상 기사가 없다.
 */

export type NewsItem = {
  /** 언론사ID/기사ID (예: "005/0001854239") */
  id: string;
  title: string;
  /** 요약(있을 때만) */
  summary: string;
  press: string;
  /** 상대 시각 문자열 (예: "3시간전") */
  datetime: string;
  link: string;
  /** 썸네일 이미지 URL (없으면 null) */
  thumbnail: string | null;
};

/** 네이버 뉴스 상위 섹션(sid) 카테고리 */
export const CATEGORIES = [
  { sid: "101", label: "경제" },
  { sid: "105", label: "IT·과학" },
  { sid: "104", label: "세계" },
  { sid: "102", label: "사회" },
  { sid: "100", label: "정치" },
  { sid: "103", label: "생활·문화" },
] as const;

export type CategorySid = (typeof CATEGORIES)[number]["sid"];

/** 경제 섹션 sid */
const ECONOMY_SID = "101";

const VALID_SIDS = new Set<string>(CATEGORIES.map((c) => c.sid));

/** 섹션 sid 유효성 검증 (잘못된 값이면 경제로 폴백) */
export function normalizeSid(sid: string | null | undefined): string {
  return sid && VALID_SIDS.has(sid) ? sid : ECONOMY_SID;
}

const SECTION_TEMPLATE_URL =
  "https://news.naver.com/section/template/SECTION_ARTICLE_LIST";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type SectionPage = {
  html: string;
  /** 다음 페이지 커서 (없으면 null) */
  nextCursor: string | null;
  /** 다음 pageNo */
  nextPageNo: number;
  hasNext: boolean;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x3D;/g, "=")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** 단일 섹션 페이지(JSON 안의 HTML)를 가져온다 */
async function fetchSectionPage(
  sid: string,
  pageNo: number,
  cursor: string,
  signal?: AbortSignal,
): Promise<SectionPage> {
  const url = new URL(SECTION_TEMPLATE_URL);
  url.searchParams.set("sid", sid);
  url.searchParams.set("sid2", "");
  url.searchParams.set("cluid", "");
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("date", "");
  url.searchParams.set("next", cursor);
  url.searchParams.set("_", String(pageNo));

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: `https://news.naver.com/section/${sid}`,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    cache: "no-store",
    signal,
  });

  if (!res.ok) {
    throw new Error(`네이버 섹션 요청 실패: HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    renderedComponent?: { SECTION_ARTICLE_LIST?: string };
  };
  const html = data.renderedComponent?.SECTION_ARTICLE_LIST ?? "";

  const cursorMatch = html.match(/data-cursor="(\d+)"/);
  const pageMatch = html.match(/data-page-no="(\d+)"/);
  const hasNextMatch = html.match(/data-has-next="(true|false)"/);

  return {
    html,
    nextCursor: cursorMatch ? cursorMatch[1] : null,
    nextPageNo: pageMatch ? Number(pageMatch[1]) : pageNo + 1,
    hasNext: hasNextMatch ? hasNextMatch[1] === "true" : false,
  };
}

/** 섹션 HTML 한 덩어리에서 기사 항목들을 파싱한다 */
function parseItems(html: string): NewsItem[] {
  const items: NewsItem[] = [];
  // 각 기사 블록은 <li class="sa_item ..."> ... </li>
  const blocks = html.split(/<li class="sa_item/).slice(1);

  for (const block of blocks) {
    // 속성 순서(href/class)가 바뀌어도 매칭되도록 anchor 전체를 먼저 잡는다
    const titleAnchor = block.match(
      /<a\b[^>]*\bclass="[^"]*sa_text_title[^"]*"[^>]*>([\s\S]*?)<\/a>/,
    );
    if (!titleAnchor) continue;

    const hrefMatch = titleAnchor[0].match(/\bhref="([^"]+)"/);
    if (!hrefMatch) continue;
    const link = decodeEntities(hrefMatch[1]);
    const idMatch = link.match(/article\/(?:comment\/)?(\d+)\/(\d+)/);
    if (!idMatch) continue;
    const id = `${idMatch[1]}/${idMatch[2]}`;

    const strong = titleAnchor[1].match(
      /<strong[^>]*class="[^"]*sa_text_strong[^"]*"[^>]*>([\s\S]*?)<\/strong>/,
    );
    const title = strong ? stripTags(strong[1]) : stripTags(titleAnchor[1]);
    if (!title) continue;

    const summaryMatch = block.match(
      /class="sa_text_lede"[^>]*>([\s\S]*?)<\/div>/,
    );
    const pressMatch = block.match(
      /class="sa_text_press"[^>]*>([\s\S]*?)<\/div>/,
    );
    const datetimeMatch = block.match(
      /class="sa_text_datetime[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    );
    const thumbMatch = block.match(/data-src="([^"]+)"/);

    items.push({
      id,
      title,
      summary: summaryMatch ? stripTags(summaryMatch[1]) : "",
      press: pressMatch ? stripTags(pressMatch[1]) : "",
      datetime: datetimeMatch ? stripTags(datetimeMatch[1]) : "",
      link,
      thumbnail: thumbMatch ? decodeEntities(thumbMatch[1]) : null,
    });
  }

  return items;
}

/**
 * 네이버 뉴스 섹션을 `count` 개 수집한다 (기본 경제, 100개).
 * 커서 기반으로 페이지를 넘기며 중복을 제거한다.
 */
export async function fetchSectionNews(
  sid: string = ECONOMY_SID,
  count = 100,
  options: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<NewsItem[]> {
  const section = normalizeSid(sid);
  const { maxPages = 20, signal } = options;
  const collected: NewsItem[] = [];
  const seen = new Set<string>();

  let cursor = "";
  let pageNo = 1;

  for (let page = 0; page < maxPages; page++) {
    const { html, nextCursor, nextPageNo, hasNext } = await fetchSectionPage(
      section,
      pageNo,
      cursor,
      signal,
    );

    for (const item of parseItems(html)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      collected.push(item);
      if (collected.length >= count) return collected;
    }

    if (!hasNext || !nextCursor) break;
    cursor = nextCursor;
    pageNo = nextPageNo;
  }

  return collected;
}

/** 경제 섹션 전용 단축 함수 (하위 호환) */
export function fetchEconomyNews(
  count = 100,
  options: { maxPages?: number; signal?: AbortSignal } = {},
): Promise<NewsItem[]> {
  return fetchSectionNews(ECONOMY_SID, count, options);
}

/**
 * 네이버 뉴스 기사 본문을 가져온다.
 * n.news.naver.com 기사 페이지의 #dic_area 컨테이너를 파싱한다.
 */
export async function fetchArticleBody(
  url: string,
  signal?: AbortSignal,
): Promise<{ body: string; reporter: string | null; publishedAt: string | null }> {
  const parsed = new URL(url);
  if (!parsed.hostname.endsWith("news.naver.com")) {
    throw new Error("네이버 뉴스 기사 URL만 지원합니다.");
  }

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`기사 요청 실패: HTTP ${res.status}`);

  const html = await res.text();

  const articleMatch =
    html.match(/<article[^>]*id="dic_area"[^>]*>([\s\S]*?)<\/article>/) ??
    html.match(/<div[^>]*id="newsct_article"[^>]*>([\s\S]*?)<\/div>/);
  if (!articleMatch) throw new Error("기사 본문을 찾을 수 없습니다.");

  let body = articleMatch[1];
  body = body.replace(/<script[\s\S]*?<\/script>/g, "");
  body = body.replace(/<span[^>]*class="end_photo_org"[\s\S]*?<\/span>/g, "");
  // 사진 캡션(em.img_desc)은 본문이 아니므로 제거
  body = body.replace(/<em[^>]*class="img_desc"[^>]*>[\s\S]*?<\/em>/g, "");
  body = body.replace(/<br\s*\/?>/g, "\n");
  body = decodeEntities(body.replace(/<[^>]+>/g, " "));
  // 문단 구분(\n)은 보존하면서 그 외 공백만 정리
  body = body
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  const reporterMatch = html.match(
    /<em[^>]*class="media_end_head_journalist_name"[^>]*>([\s\S]*?)<\/em>/,
  );
  const dateMatch = html.match(/data-date-time="([^"]+)"/);

  return {
    body,
    reporter: reporterMatch ? stripTags(reporterMatch[1]) : null,
    publishedAt: dateMatch ? dateMatch[1] : null,
  };
}
