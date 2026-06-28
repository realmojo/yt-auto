import type { AspectRatio } from "./types";

/** 종횡비별 베이스 렌더 해상도 */
export const ASPECT_DIMS: Record<AspectRatio, { width: number; height: number }> =
  {
    "9:16": { width: 1080, height: 1920 },
    "16:9": { width: 1920, height: 1080 },
    "1:1": { width: 1080, height: 1080 },
    "4:5": { width: 1080, height: 1350 },
  };

export const ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: "9:16", label: "9:16 세로 (쇼츠/릴스)" },
  { value: "16:9", label: "16:9 가로 (유튜브)" },
  { value: "1:1", label: "1:1 정사각" },
  { value: "4:5", label: "4:5 인스타 피드" },
];

export const DEFAULT_FPS = 30;
/** 제목 텍스트 기본 폰트 크기(px, 베이스 해상도 기준) */
export const DEFAULT_TITLE_FONT = 80;
export const MIN_DURATION = 3; // 프로젝트 최소 길이(초)
export const MIN_CLIP_DURATION = 0.2; // 클립 최소 길이(초)
export const HISTORY_LIMIT = 80;

/** 타임라인 줌 한계 (px/초) */
export const MIN_PPS = 8;
export const MAX_PPS = 320;
export const DEFAULT_PPS = 70;

/** 스냅 허용 오차(px) */
export const SNAP_PX = 7;

/** 폰트 목록 — 캔버스/CSS 공용 family 문자열 */
export const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: '"Noto Sans KR", sans-serif', label: "Noto Sans (한글)" },
  { value: 'var(--font-inter), "Noto Sans KR", sans-serif', label: "Inter" },
  { value: "Georgia, serif", label: "Georgia (Serif)" },
  { value: '"Times New Roman", serif', label: "Times" },
  { value: '"Courier New", monospace', label: "Courier (Mono)" },
  { value: "Impact, sans-serif", label: "Impact (굵은 제목)" },
];

/** 인스펙터 색상 스와치 */
export const SWATCHES = [
  "#ffffff",
  "#f8fafc",
  "#facc15",
  "#fb923c",
  "#f87171",
  "#f472b6",
  "#a78bfa",
  "#60a5fa",
  "#34d399",
  "#22d3ee",
  "#0f172a",
  "#000000",
];

export const TRACK_KIND_LABEL: Record<string, string> = {
  video: "비디오",
  overlay: "오버레이",
  text: "텍스트",
  audio: "오디오",
};
