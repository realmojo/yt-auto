export interface Country {
  code: string; // ISO 3166-1 alpha-2 (YouTube regionCode)
  name: string; // 한국어 표기
  flag: string; // 국기 이모지
  /** 현지어 "쇼츠" 검색어 — 국가별 실제 쇼츠를 분리하는 핵심 */
  q: string;
  /** relevanceLanguage (ISO 639-1) */
  lang: string;
}

/** 쇼츠가 활발한 주요 국가들 (현지어 검색어 포함) */
export const COUNTRIES: Country[] = [
  { code: "KR", name: "한국", flag: "🇰🇷", q: "쇼츠", lang: "ko" },
  { code: "US", name: "미국", flag: "🇺🇸", q: "shorts", lang: "en" },
  { code: "JP", name: "일본", flag: "🇯🇵", q: "ショート", lang: "ja" },
  { code: "GB", name: "영국", flag: "🇬🇧", q: "shorts", lang: "en" },
  { code: "IN", name: "인도", flag: "🇮🇳", q: "shorts", lang: "hi" },
  { code: "BR", name: "브라질", flag: "🇧🇷", q: "shorts", lang: "pt" },
  { code: "ID", name: "인도네시아", flag: "🇮🇩", q: "shorts", lang: "id" },
  { code: "VN", name: "베트남", flag: "🇻🇳", q: "shorts", lang: "vi" },
  { code: "TW", name: "대만", flag: "🇹🇼", q: "短片", lang: "zh" },
  { code: "TH", name: "태국", flag: "🇹🇭", q: "shorts", lang: "th" },
  { code: "PH", name: "필리핀", flag: "🇵🇭", q: "shorts", lang: "en" },
  { code: "DE", name: "독일", flag: "🇩🇪", q: "shorts", lang: "de" },
  { code: "FR", name: "프랑스", flag: "🇫🇷", q: "shorts", lang: "fr" },
  { code: "MX", name: "멕시코", flag: "🇲🇽", q: "shorts", lang: "es" },
  { code: "CA", name: "캐나다", flag: "🇨🇦", q: "shorts", lang: "en" },
  { code: "AU", name: "호주", flag: "🇦🇺", q: "shorts", lang: "en" },
];

export function countryByCode(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

/** 언어별 고유 문자 범위 — 현지 콘텐츠를 글로벌 바이럴과 구분해 상위 노출하는 데 사용 */
const SCRIPT: Record<string, RegExp> = {
  ko: /[가-힣]/, // 한글
  ja: /[぀-ヿ]/, // 히라가나·가타카나
  zh: /[一-鿿]/, // 한자
  th: /[฀-๿]/, // 태국 문자
};

/** 텍스트가 해당 언어의 고유 문자를 포함하는지 (라틴 문자권은 항상 false) */
export function isLocalScript(text: string, lang: string): boolean {
  const re = SCRIPT[lang];
  return re ? re.test(text) : false;
}

// 공식/예고편/뮤직비디오 등 "재가공 부적합" 콘텐츠 판별 — 채널명·제목 기준
const OFFICIAL_CHANNEL =
  /VEVO\b|-\s*Topic$|\bMovies\b|\bPictures\b|\bStudios\b|\bRecords\b|Netflix|Disney|Marvel|Warner|Sony\s*Pictures|Paramount|Universal\s*Pictures|\bHBO\b|Prime\s*Video|Crunchyroll|Lionsgate|DreamWorks|Pixar|20th\s*Century/i;
const OFFICIAL_TITLE =
  /official\s*(?:trailer|video|music\s*video|audio)|\bteaser\b|\btrailer\b|tr[áa]iler|예고편|티저|뮤직비디오|뮤비|ティザー|予告編?|本予告/i;

/** 공식 예고편·뮤직비디오 등(재가공용 쇼츠가 아님)인지 */
export function isOfficialLike(channelTitle: string, title: string): boolean {
  return OFFICIAL_CHANNEL.test(channelTitle) || OFFICIAL_TITLE.test(title);
}

export interface ShortVideo {
  id: string;
  title: string;
  channelTitle: string;
  channelId: string;
  thumbnail: string;
  views: number;
  likes: number;
  durationSec: number;
  publishedAt: string;
  url: string;
}

/** ISO 8601 기간(PT#H#M#S) → 초 */
export function parseISODuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return (Number(h) || 0) * 3600 + (Number(min) || 0) * 60 + (Number(s) || 0);
}

/** 조회수 한국어 축약: 8,432 · 12.3만 · 1.2억 */
export function formatViews(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1).replace(/\.0$/, "")}억`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1).replace(/\.0$/, "")}만`;
  return n.toLocaleString("ko-KR");
}

/** 초 → m:ss */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 발행 시각 → "3일 전" 형태 (now 는 Date.now()) */
export function timeAgo(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return `${Math.floor(day / 7)}주 전`;
}
