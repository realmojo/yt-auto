/**
 * AI 대본(마크다운)에서 실제 발화(내레이션) 줄만 뽑아 자막 줄 배열로 변환한다.
 * - "## … 대본" 섹션만 사용 (제목 후보·썸네일·설명란 등은 제외)
 * - 헤딩(###)·인용(>)을 먼저 걷어내고 한 덩어리로 합친 뒤,
 *   B-roll([…])·연출 괄호((영상:…))·화자 라벨·타임코드·마크다운 강조·따옴표를 제거
 *   (여러 줄에 걸친 괄호 지시문도 합친 뒤 제거하므로 안전하게 처리된다)
 * - 남은 텍스트를 문장 단위로 분할
 */
export function scriptToSubtitleLines(markdown: string): string[] {
  if (!markdown.trim()) return [];

  const section = extractScriptSection(markdown);

  // 1) 헤딩/인용 줄 제거 후 한 덩어리로 합친다 (여러 줄 괄호를 통째로 처리하기 위해)
  const joined = section
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith("#") && !t.startsWith(">");
    })
    .join("\n");

  // 2) 연출 표기·마크다운·라벨·따옴표 제거
  const cleaned = joined
    .replace(/\[[^\]]*\]/g, " ") // [B-Roll: …]
    .replace(/[(（][^)）]*[:：][^)）]*[)）]/g, " ") // (영상: …) (첫 5초: …) 등 라벨형 괄호
    .replace(
      /[(（](?:큐|큐사인|리액션|줌|포즈|효과음|BGM|자막|연출|영상|화면|장면|음악|나레이션|내레이션)[^)）]*[)）]/g,
      " ",
    ) // 키워드형 연출 괄호
    .replace(/\d{1,2}:\d{2}\s*[~\-–—]\s*\d{1,2}:\d{2}/g, " ") // 0:00~0:30 타임코드
    .replace(/\*\*/g, "")
    .replace(/[*_`]/g, "") // 마크다운 강조
    .replace(/^[ \t]*(?:[-*•]|\d+\.)[ \t]+/gm, "") // 리스트 마커
    .replace(
      /(?:^|\s)(?:화자|내레이션|나레이션|나레이터|진행자|성우|해설|MC)\s*[:：]\s*/g,
      " ",
    ) // 화자 라벨
    .replace(/["'“”‘’]/g, " ") // 따옴표
    .replace(/[ \t]+/g, " ");

  return splitSentences(cleaned);
}

/** "## … 대본" 헤딩 ~ 다음 "## " 헤딩 사이를 추출. 헤딩이 없으면 전체 반환. */
function extractScriptSection(md: string): string {
  const lines = md.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+.*대본/.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return md;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** 문장 종결부호/줄바꿈 기준으로 자막 줄 분할 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.?!…。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
