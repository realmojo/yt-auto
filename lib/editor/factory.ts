import {
  ASPECT_DIMS,
  DEFAULT_FPS,
  DEFAULT_TITLE_FONT,
  MIN_DURATION,
} from "./constants";
import { uid } from "./geometry";
import type {
  AspectRatio,
  AudioClip,
  ImageClip,
  MediaAsset,
  Project,
  ShapeClip,
  TextClip,
  Track,
  VideoClip,
} from "./types";

export function makeTracks(): Track[] {
  // 배열 인덱스 0 = 최하단(뒤). 렌더는 0부터 그려 위로 쌓는다.
  return [
    { id: uid("trk"), kind: "video", name: "비디오 V1", hidden: false, locked: false, muted: false },
    { id: uid("trk"), kind: "overlay", name: "오버레이", hidden: false, locked: false, muted: false },
    { id: uid("trk"), kind: "text", name: "자막", hidden: false, locked: false, muted: false },
    { id: uid("trk"), kind: "audio", name: "오디오", hidden: false, locked: false, muted: false },
  ];
}

export function makeProject(aspect: AspectRatio = "9:16"): Project {
  const dims = ASPECT_DIMS[aspect];
  const tracks = makeTracks();
  const textTrack = tracks.find((t) => t.kind === "text")!;
  const title = makeTextClip(textTrack.id, dims.width, dims.height, {
    text: "제목을\n입력하세요",
    fontSize: DEFAULT_TITLE_FONT,
    fontWeight: 800,
    y: Math.round(dims.height * 0.16),
    height: Math.round(dims.height * 0.18),
    name: "제목",
    background: null,
    start: 0,
    duration: MIN_DURATION,
  });
  const subtitle = makeTextClip(textTrack.id, dims.width, dims.height, {
    text: "자막을 입력하세요",
    fontSize: Math.round(dims.width * 0.04),
    fontWeight: 600,
    y: Math.round(dims.height * 0.72),
    height: Math.round(dims.height * 0.1),
    name: "자막",
    background: "rgba(8,12,24,0.72)",
    start: 0,
    duration: MIN_DURATION,
  });
  return {
    id: uid("prj"),
    name: "새 프로젝트",
    aspect,
    width: dims.width,
    height: dims.height,
    fps: DEFAULT_FPS,
    duration: MIN_DURATION,
    background: "linear-gradient(160deg, #0b1020 0%, #131a30 100%)",
    watermark: { enabled: false, text: "해숏티", opacity: 0.14 },
    tracks,
    clips: [title, subtitle],
  };
}

export function makeTextClip(
  trackId: string,
  W: number,
  H: number,
  patch: Partial<TextClip> = {},
): TextClip {
  const width = patch.width ?? Math.round(W * 0.86);
  return {
    id: uid("clp"),
    type: "text",
    trackId,
    start: patch.start ?? 0,
    duration: patch.duration ?? MIN_DURATION,
    name: patch.name ?? "텍스트",
    x: patch.x ?? Math.round((W - width) / 2),
    y: patch.y ?? Math.round(H * 0.42),
    width,
    height: patch.height ?? Math.round(H * 0.12),
    rotation: 0,
    opacity: 1,
    text: patch.text ?? "텍스트를 입력하세요",
    color: patch.color ?? "#ffffff",
    fontFamily: patch.fontFamily ?? '"Noto Sans KR", sans-serif',
    fontSize: patch.fontSize ?? Math.round(W * 0.045),
    fontWeight: patch.fontWeight ?? 700,
    italic: patch.italic ?? false,
    align: patch.align ?? "center",
    vAlign: patch.vAlign ?? "middle",
    lineHeight: patch.lineHeight ?? 1.3,
    letterSpacing: patch.letterSpacing ?? 0,
    background: patch.background ?? null,
    stroke: patch.stroke ?? null,
    shadow: patch.shadow ?? true,
  };
}

export function makeShapeClip(
  trackId: string,
  W: number,
  H: number,
  patch: Partial<ShapeClip> = {},
): ShapeClip {
  return {
    id: uid("clp"),
    type: "shape",
    trackId,
    start: patch.start ?? 0,
    duration: patch.duration ?? MIN_DURATION,
    name: patch.name ?? "도형",
    x: patch.x ?? Math.round(W * 0.2),
    y: patch.y ?? Math.round(H * 0.4),
    width: patch.width ?? Math.round(W * 0.6),
    height: patch.height ?? Math.round(W * 0.6),
    rotation: 0,
    opacity: patch.opacity ?? 1,
    shape: patch.shape ?? "rect",
    fill: patch.fill ?? "#4f5af5",
    radius: patch.radius ?? 24,
    stroke: patch.stroke ?? null,
  };
}

export function makeImageClip(
  trackId: string,
  asset: MediaAsset,
  W: number,
  H: number,
  patch: Partial<ImageClip> = {},
): ImageClip {
  const fitted = fitInto(asset.width, asset.height, W * 0.8, H * 0.5);
  return {
    id: uid("clp"),
    type: "image",
    trackId,
    start: patch.start ?? 0,
    duration: patch.duration ?? Math.max(2, asset.duration || 4),
    name: patch.name ?? asset.name,
    x: patch.x ?? Math.round((W - fitted.w) / 2),
    y: patch.y ?? Math.round((H - fitted.h) / 2),
    width: patch.width ?? Math.round(fitted.w),
    height: patch.height ?? Math.round(fitted.h),
    rotation: 0,
    opacity: 1,
    src: asset.url,
    assetId: asset.id,
    objectFit: patch.objectFit ?? "cover",
    radius: patch.radius ?? 0,
  };
}

/** 업로드 에셋 없이 URL(또는 프록시 경로)로 이미지 클립 생성 — 템플릿 로고 등 */
export function makeUrlImageClip(
  trackId: string,
  url: string,
  assetId: string,
  W: number,
  H: number,
  patch: Partial<ImageClip> = {},
): ImageClip {
  return {
    id: uid("clp"),
    type: "image",
    trackId,
    start: patch.start ?? 0,
    duration: patch.duration ?? MIN_DURATION,
    name: patch.name ?? "이미지",
    x: patch.x ?? 0,
    y: patch.y ?? 0,
    width: patch.width ?? Math.round(W * 0.2),
    height: patch.height ?? Math.round(W * 0.2),
    rotation: 0,
    opacity: patch.opacity ?? 1,
    src: url,
    assetId,
    objectFit: patch.objectFit ?? "cover",
    radius: patch.radius ?? 0,
  };
}

export function makeVideoClip(
  trackId: string,
  asset: MediaAsset,
  W: number,
  H: number,
  patch: Partial<VideoClip> = {},
): VideoClip {
  const fitted = fitInto(asset.width || W, asset.height || H, W, H);
  return {
    id: uid("clp"),
    type: "video",
    trackId,
    start: patch.start ?? 0,
    duration: patch.duration ?? Math.max(1, asset.duration || 5),
    name: patch.name ?? asset.name,
    x: patch.x ?? Math.round((W - fitted.w) / 2),
    y: patch.y ?? Math.round((H - fitted.h) / 2),
    width: patch.width ?? Math.round(fitted.w),
    height: patch.height ?? Math.round(fitted.h),
    rotation: 0,
    opacity: 1,
    src: asset.url,
    assetId: asset.id,
    objectFit: patch.objectFit ?? "cover",
    radius: patch.radius ?? 0,
    trimStart: patch.trimStart ?? 0,
    volume: patch.volume ?? 1,
    muted: patch.muted ?? false,
  };
}

export function makeAudioClip(
  trackId: string,
  asset: MediaAsset,
  patch: Partial<AudioClip> = {},
): AudioClip {
  return {
    id: uid("clp"),
    type: "audio",
    trackId,
    start: patch.start ?? 0,
    duration: patch.duration ?? Math.max(1, asset.duration || 5),
    name: patch.name ?? asset.name,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    opacity: 1,
    src: asset.url,
    assetId: asset.id,
    trimStart: patch.trimStart ?? 0,
    volume: patch.volume ?? 1,
    muted: patch.muted ?? false,
  };
}

/** 종횡비 유지하며 박스 안에 맞춤 */
export function fitInto(
  sw: number,
  sh: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  if (sw <= 0 || sh <= 0) return { w: maxW, h: maxH };
  const scale = Math.min(maxW / sw, maxH / sh, 1.5);
  return { w: sw * scale, h: sh * scale };
}
