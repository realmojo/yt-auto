import type { Clip, Project, VisualClip } from "./types";

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** 고유 id */
export function uid(prefix = "id"): string {
  const g = globalThis as unknown as { crypto?: Crypto };
  const rnd =
    g.crypto && "randomUUID" in g.crypto
      ? g.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rnd}`;
}

/** 초 → "0:08.4" 형식 */
export function fmtTime(sec: number, withMs = true): string {
  const s = Math.max(0, sec);
  let m = Math.floor(s / 60);
  let r = s - m * 60;
  if (withMs) {
    r = Math.round(r * 10) / 10; // 먼저 0.1초 단위 반올림
    if (r >= 60) {
      m += 1;
      r = 0;
    } // 분으로 올림 (":60.0" 방지)
    return `${m}:${r.toFixed(1).padStart(4, "0")}`;
  }
  return `${m}:${Math.floor(r).toString().padStart(2, "0")}`;
}

/** 클립이 시각 클립인지(렌더 대상) */
export function visualClips(project: Project): VisualClip[] {
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  return project.clips
    .filter((c): c is VisualClip => c.type !== "audio")
    .filter((c) => {
      const t = project.tracks.find((tk) => tk.id === c.trackId);
      return t ? !t.hidden : true;
    })
    .sort((a, b) => {
      const ta = trackIndex.get(a.trackId) ?? 0;
      const tb = trackIndex.get(b.trackId) ?? 0;
      if (ta !== tb) return ta - tb; // 낮은 트랙 인덱스 = 뒤(먼저 그림)
      return a.start - b.start;
    });
}

/** 특정 시각에 활성화된 클립인가 */
export function isActiveAt(clip: Clip, t: number): boolean {
  return t >= clip.start && t < clip.start + clip.duration - 1e-6;
}

/** 클립들로부터 프로젝트 총 길이 계산 (최소값 보장) */
export function computeDuration(clips: Clip[], min: number): number {
  let end = min;
  for (const c of clips) end = Math.max(end, c.start + c.duration);
  return end;
}

/** 회전 고려 없이 점이 박스 안에 있는지 */
export function pointInClip(
  c: VisualClip,
  px: number,
  py: number,
): boolean {
  return px >= c.x && px <= c.x + c.width && py >= c.y && py <= c.y + c.height;
}

/** objectFit 적용 시 소스 → 대상 그리기 사각형 계산 (cover/contain/fill) */
export function fitRect(
  fit: "cover" | "contain" | "fill",
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): { sx: number; sy: number; sWidth: number; sHeight: number } {
  if (fit === "fill" || sw <= 0 || sh <= 0) {
    return { sx: 0, sy: 0, sWidth: sw, sHeight: sh };
  }
  const sAspect = sw / sh;
  const dAspect = dw / dh;
  if (fit === "cover") {
    // 소스를 잘라 대상을 가득 채움
    if (sAspect > dAspect) {
      const sWidth = sh * dAspect;
      return { sx: (sw - sWidth) / 2, sy: 0, sWidth, sHeight: sh };
    }
    const sHeight = sw / dAspect;
    return { sx: 0, sy: (sh - sHeight) / 2, sWidth: sw, sHeight };
  }
  // contain: 소스 전체가 보이도록 (대상 안쪽 레터박스) — 그리기 대상 쪽을 줄임
  return { sx: 0, sy: 0, sWidth: sw, sHeight: sh };
}

/** contain 모드에서 대상 박스 안에 들어갈 실제 그리기 사각형 */
export function containRect(
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): { x: number; y: number; w: number; h: number } {
  if (sw <= 0 || sh <= 0) return { x: dx, y: dy, w: dw, h: dh };
  const scale = Math.min(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: dx + (dw - w) / 2, y: dy + (dh - h) / 2, w, h };
}

export type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

/** 리사이즈 핸들 적용 — 새 박스 반환 (회전 미고려, MVP) */
export function applyResize(
  box: { x: number; y: number; width: number; height: number },
  handle: ResizeHandle,
  dx: number,
  dy: number,
  opts: { keepAspect?: boolean; min?: number } = {},
): { x: number; y: number; width: number; height: number } {
  const min = opts.min ?? 20;
  let { x, y, width, height } = box;
  const right = x + width;
  const bottom = y + height;

  if (handle.includes("w")) {
    x = Math.min(x + dx, right - min);
    width = right - x;
  }
  if (handle.includes("e")) {
    width = Math.max(min, width + dx);
  }
  if (handle.includes("n")) {
    y = Math.min(y + dy, bottom - min);
    height = bottom - y;
  }
  if (handle.includes("s")) {
    height = Math.max(min, height + dy);
  }

  if (opts.keepAspect) {
    const aspect = box.width / box.height;
    // 가로 우선으로 비율 맞춤
    if (handle === "e" || handle === "w") height = width / aspect;
    else if (handle === "n" || handle === "s") width = height * aspect;
    else width = height * aspect;
    // 좌/상 핸들은 반대쪽 모서리를 고정하도록 x/y 재정렬 (안 그러면 박스가 드리프트)
    if (handle.includes("w")) x = right - width;
    if (handle.includes("n")) y = bottom - height;
  }

  return { x, y, width, height };
}

/** 스냅 대상 후보(초)들에 currentTime/clip edge 를 끌어당김 */
export function snapTime(
  value: number,
  candidates: number[],
  tolerance: number,
): number {
  let best = value;
  let bestDist = tolerance;
  for (const c of candidates) {
    const d = Math.abs(c - value);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}
