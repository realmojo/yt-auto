/**
 * 웹 영상 편집기 — 공유 데이터 모델
 *
 * 모든 시각 요소는 "베이스 해상도" 픽셀 좌표계(예: 1080×1920) 위에 배치된다.
 * 미리보기 캔버스는 이 좌표계를 컨테이너 크기에 맞춰 scale 만 적용해 그리고,
 * export 는 scale=1(풀 해상도)로 동일 렌더러를 재사용한다. → 미리보기와 결과물이 항상 일치.
 */

export type AspectRatio = "9:16" | "16:9" | "1:1" | "4:5";

export type ClipType = "text" | "image" | "video" | "audio" | "shape";

export type TrackKind = "video" | "overlay" | "text" | "audio";

export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
export type ObjectFit = "cover" | "contain" | "fill";
export type ShapeKind = "rect" | "ellipse";

/** 모든 클립의 공통 필드 */
export interface BaseClip {
  id: string;
  type: ClipType;
  trackId: string;
  /** 타임라인상 시작 시각(초) */
  start: number;
  /** 길이(초) */
  duration: number;
  name: string;
  /** 베이스 좌표계 기준 박스 (오디오 클립은 무시) */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // deg
  opacity: number; // 0..1
}

export interface TextClip extends BaseClip {
  type: "text";
  text: string;
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number; // 400 | 700 | ...
  italic: boolean;
  align: Align;
  vAlign: VAlign;
  lineHeight: number; // 배수
  letterSpacing: number; // px
  /** 자막 배경 하이라이트 박스 색 (없으면 null) */
  background: string | null;
  /** 외곽선 (없으면 null) */
  stroke: { color: string; width: number } | null;
  /** 그림자 사용 */
  shadow: boolean;
}

export interface ImageClip extends BaseClip {
  type: "image";
  src: string;
  /** 미디어 라이브러리 에셋 id (export 시 엘리먼트 매칭용) */
  assetId: string;
  objectFit: ObjectFit;
  radius: number;
}

export interface VideoClip extends BaseClip {
  type: "video";
  src: string;
  assetId: string;
  objectFit: ObjectFit;
  radius: number;
  /** 원본에서 잘라 쓰기 시작 지점(초) */
  trimStart: number;
  volume: number; // 0..1
  muted: boolean;
}

export interface AudioClip extends BaseClip {
  type: "audio";
  src: string;
  assetId: string;
  trimStart: number;
  volume: number; // 0..1
  muted: boolean;
}

export interface ShapeClip extends BaseClip {
  type: "shape";
  shape: ShapeKind;
  fill: string;
  radius: number;
  stroke: { color: string; width: number } | null;
}

export type Clip =
  | TextClip
  | ImageClip
  | VideoClip
  | AudioClip
  | ShapeClip;

export type VisualClip = TextClip | ImageClip | VideoClip | ShapeClip;
export type MediaClip = VideoClip | AudioClip;

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  hidden: boolean;
  locked: boolean;
  muted: boolean;
}

/** 화면 가운데 흐릿하게 깔리는 브랜드 워터마크 (클립이 아닌 전역 오버레이) */
export interface WatermarkConfig {
  enabled: boolean;
  text: string;
  /** 0..1 */
  opacity: number;
}

export interface Project {
  id: string;
  name: string;
  aspect: AspectRatio;
  /** 베이스 렌더 해상도 */
  width: number;
  height: number;
  fps: number;
  /** 총 길이(초). 클립으로부터 파생되지만 최소값 보장 */
  duration: number;
  /** 배경: CSS 색 또는 'linear-gradient(...)' 문자열 */
  background: string;
  watermark: WatermarkConfig;
  tracks: Track[];
  clips: Clip[];
}

/** 미디어 라이브러리 에셋 (업로드된 파일) */
export interface MediaAsset {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  /** objectURL */
  url: string;
  /** 미디어 자연 길이(초) — 이미지는 0 */
  duration: number;
  width: number;
  height: number;
}

export interface EditorState {
  project: Project;
  assets: MediaAsset[];
  currentTime: number;
  playing: boolean;
  /** 반복 재생 */
  loop: boolean;
  /** 타임라인 스냅 on/off */
  snapping: boolean;
  selectedIds: string[];
  /** 타임라인 px/초 */
  pxPerSecond: number;
  past: Project[];
  future: Project[];
}

/** clip 타입 가드들 */
export const isVisual = (c: Clip): c is VisualClip => c.type !== "audio";
export const isMedia = (c: Clip): c is MediaClip =>
  c.type === "video" || c.type === "audio";
export const isText = (c: Clip): c is TextClip => c.type === "text";
