import { containRect } from "./geometry";
import type {
  ImageClip,
  Project,
  ShapeClip,
  TextClip,
  VideoClip,
  VisualClip,
} from "./types";
import { isActiveAt, visualClips } from "./geometry";

/** 렌더러가 미디어 엘리먼트를 찾기 위한 인터페이스 */
export interface RenderResolver {
  /** 이미지 에셋 → 디코드된 이미지 (없거나 미완료면 null) */
  getImage(assetId: string): HTMLImageElement | null;
  /** 비디오 클립 → 동기화된 video 엘리먼트 (없으면 null) */
  getVideo(clipId: string): HTMLVideoElement | null;
}

const NULL_RESOLVER: RenderResolver = {
  getImage: () => null,
  getVideo: () => null,
};

export interface DrawOptions {
  /** 베이스 좌표 → 캔버스 픽셀 배율 (preview=dpr*fit, export=1) */
  renderScale: number;
  resolver?: RenderResolver;
  /** 배경을 그리지 않음 — 투명 오버레이(템플릿만) 렌더용 */
  transparent?: boolean;
}

/**
 * 프로젝트의 time(초) 시점 프레임을 캔버스에 그린다.
 * 캔버스 backing store 는 미리 (W*renderScale) × (H*renderScale) 로 맞춰져 있어야 한다.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  time: number,
  opts: DrawOptions,
): void {
  const { renderScale, transparent } = opts;
  const resolver = opts.resolver ?? NULL_RESOLVER;
  const W = project.width;
  const H = project.height;

  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!transparent) drawBackground(ctx, project.background, W, H);

  for (const clip of visualClips(project)) {
    if (!isActiveAt(clip, time)) continue;
    ctx.save();
    ctx.globalAlpha = clamp01(clip.opacity);
    applyRotation(ctx, clip);
    switch (clip.type) {
      case "text":
        drawText(ctx, clip);
        break;
      case "image":
        drawImageClip(ctx, clip, resolver);
        break;
      case "video":
        drawVideoClip(ctx, clip, time, resolver);
        break;
      case "shape":
        drawShape(ctx, clip);
        break;
    }
    ctx.restore();
  }

  // 전역 워터마크 (모든 클립 위, 가운데, 흐릿하게)
  if (project.watermark?.enabled && project.watermark.text.trim()) {
    drawWatermark(ctx, project);
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function drawWatermark(
  ctx: CanvasRenderingContext2D,
  project: Project,
) {
  const { width: W, height: H, watermark } = project;
  ctx.save();
  ctx.globalAlpha = clamp01(watermark.opacity);
  const fontSize = Math.round(W * 0.06);
  ctx.font = `800 ${fontSize}px "Noto Sans KR", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  // 흐릿한 느낌: 약한 블러 + 부드러운 그림자 (블러 미지원 브라우저는 투명도만 적용)
  try {
    ctx.filter = `blur(${Math.max(1, fontSize * 0.03)}px)`;
  } catch {
    /* noop */
  }
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = fontSize * 0.2;
  ctx.fillText(watermark.text, W / 2, H / 2);
  ctx.restore();
}

function applyRotation(ctx: CanvasRenderingContext2D, c: VisualClip) {
  if (!c.rotation) return;
  const cx = c.x + c.width / 2;
  const cy = c.y + c.height / 2;
  ctx.translate(cx, cy);
  ctx.rotate((c.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);
}

/* ───────── 배경 ───────── */

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  background: string,
  W: number,
  H: number,
) {
  const grad = background.trim().startsWith("linear-gradient")
    ? makeGradient(ctx, background, W, H)
    : null;
  ctx.fillStyle = grad ?? background;
  ctx.fillRect(0, 0, W, H);
}

function makeGradient(
  ctx: CanvasRenderingContext2D,
  css: string,
  W: number,
  H: number,
): CanvasGradient | null {
  const inner = css.slice(css.indexOf("(") + 1, css.lastIndexOf(")"));
  // 각도 추출
  const angleMatch = inner.match(/^\s*([\d.]+)deg/);
  const angle = angleMatch ? parseFloat(angleMatch[1]) : 180;
  // 색상 스톱 추출
  const stopRe = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))\s*([\d.]+%)?/g;
  const stops: { color: string; pos: number | null }[] = [];
  let m: RegExpExecArray | null;
  while ((m = stopRe.exec(inner))) {
    stops.push({
      color: m[1],
      pos: m[2] ? parseFloat(m[2]) / 100 : null,
    });
  }
  if (stops.length === 0) return null;

  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const cx = W / 2;
  const cy = H / 2;
  const halfLen = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
  const g = ctx.createLinearGradient(
    cx - dx * halfLen,
    cy - dy * halfLen,
    cx + dx * halfLen,
    cy + dy * halfLen,
  );
  stops.forEach((s, i) => {
    const pos =
      s.pos != null ? s.pos : stops.length === 1 ? 0 : i / (stops.length - 1);
    g.addColorStop(Math.min(1, Math.max(0, pos)), s.color);
  });
  return g;
}

/* ───────── 텍스트 ───────── */

export function textFont(c: TextClip): string {
  return `${c.italic ? "italic " : ""}${c.fontWeight} ${c.fontSize}px ${c.fontFamily}`;
}

/** 줄바꿈(\n) + 폭 기반 워드랩 (CJK 글자 단위 폴백) */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (para === "") {
      out.push("");
      continue;
    }
    const words = para.split(" ");
    let line = "";
    const flush = () => {
      if (line !== "") out.push(line);
      line = "";
    };
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      const candidate = line === "" ? word : line + " " + word;
      if (ctx.measureText(candidate).width <= maxWidth || line === "") {
        if (ctx.measureText(candidate).width <= maxWidth) {
          line = candidate;
          continue;
        }
        // line === "" 인데 단어 자체가 너무 김 → 글자 단위 분해
        let chunk = "";
        for (const ch of word) {
          const t = chunk + ch;
          if (ctx.measureText(t).width > maxWidth && chunk !== "") {
            out.push(chunk);
            chunk = ch;
          } else {
            chunk = t;
          }
        }
        line = chunk;
      } else {
        flush();
        // 새 줄에 단어를 놓되 너무 길면 다시 분해
        if (ctx.measureText(word).width <= maxWidth) {
          line = word;
        } else {
          let chunk = "";
          for (const ch of word) {
            const t = chunk + ch;
            if (ctx.measureText(t).width > maxWidth && chunk !== "") {
              out.push(chunk);
              chunk = ch;
            } else {
              chunk = t;
            }
          }
          line = chunk;
        }
      }
    }
    flush();
  }
  return out;
}

function drawText(ctx: CanvasRenderingContext2D, c: TextClip) {
  ctx.font = textFont(c);
  ctx.textBaseline = "top";
  try {
    // 일부 브라우저만 지원 — 미지원 시 무시
    (ctx as unknown as { letterSpacing: string }).letterSpacing =
      `${c.letterSpacing}px`;
  } catch {
    /* noop */
  }

  const pad = Math.max(6, c.fontSize * 0.18);
  const maxTextWidth = c.width;
  const lines = wrapText(ctx, c.text, maxTextWidth);
  const lineH = c.fontSize * c.lineHeight;
  const blockH = lines.length * lineH;

  let startY = c.y;
  if (c.vAlign === "middle") startY = c.y + (c.height - blockH) / 2;
  else if (c.vAlign === "bottom") startY = c.y + (c.height - blockH);

  // 배경 하이라이트(줄별)
  if (c.background) {
    ctx.fillStyle = c.background;
    lines.forEach((ln, i) => {
      if (ln === "") return;
      const w = ctx.measureText(ln).width;
      const lx = lineStartX(c, w);
      const ly = startY + i * lineH;
      roundRectPath(
        ctx,
        lx - pad,
        ly - pad * 0.4,
        w + pad * 2,
        lineH + pad * 0.2,
        Math.min(pad, 14),
      );
      ctx.fill();
    });
  }

  // 그림자
  if (c.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = c.fontSize * 0.18;
    ctx.shadowOffsetY = c.fontSize * 0.06;
  }

  lines.forEach((ln, i) => {
    const w = ctx.measureText(ln).width;
    const lx = lineStartX(c, w);
    const ly = startY + i * lineH + (lineH - c.fontSize) / 2;
    if (c.stroke && c.stroke.width > 0) {
      ctx.lineJoin = "round";
      ctx.strokeStyle = c.stroke.color;
      ctx.lineWidth = c.stroke.width;
      ctx.strokeText(ln, lx, ly);
    }
    ctx.fillStyle = c.color;
    ctx.fillText(ln, lx, ly);
  });

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
  } catch {
    /* noop */
  }
}

function lineStartX(c: TextClip, lineWidth: number): number {
  if (c.align === "center") return c.x + (c.width - lineWidth) / 2;
  if (c.align === "right") return c.x + c.width - lineWidth;
  return c.x;
}

/* ───────── 이미지/비디오 ───────── */

function drawImageClip(
  ctx: CanvasRenderingContext2D,
  c: ImageClip,
  resolver: RenderResolver,
) {
  const img = resolver.getImage(c.assetId);
  if (!img || !img.complete || img.naturalWidth === 0) {
    drawPlaceholder(ctx, c, "이미지");
    return;
  }
  drawMedia(
    ctx,
    img,
    img.naturalWidth,
    img.naturalHeight,
    c.x,
    c.y,
    c.width,
    c.height,
    c.objectFit,
    c.radius,
  );
}

function drawVideoClip(
  ctx: CanvasRenderingContext2D,
  c: VideoClip,
  _time: number,
  resolver: RenderResolver,
) {
  const v = resolver.getVideo(c.id);
  // 메타데이터(videoWidth>0)가 있으면 seek 중(readyState 일시 하락)이라도
  // drawImage 가 마지막 프레임을 그려 깜빡임을 막는다. placeholder 는 진짜 프레임이 없을 때만.
  if (!v || v.videoWidth === 0) {
    drawPlaceholder(ctx, c, "비디오");
    return;
  }
  drawMedia(
    ctx,
    v,
    v.videoWidth,
    v.videoHeight,
    c.x,
    c.y,
    c.width,
    c.height,
    c.objectFit,
    c.radius,
  );
}

function drawMedia(
  ctx: CanvasRenderingContext2D,
  el: CanvasImageSource,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  fit: "cover" | "contain" | "fill",
  radius: number,
) {
  ctx.save();
  if (radius > 0) {
    roundRectPath(ctx, dx, dy, dw, dh, radius);
    ctx.clip();
  }
  if (fit === "contain") {
    const r = containRect(sw, sh, dx, dy, dw, dh);
    ctx.drawImage(el, r.x, r.y, r.w, r.h);
  } else if (fit === "fill") {
    ctx.drawImage(el, dx, dy, dw, dh);
  } else {
    // cover: 소스를 크롭
    const sAspect = sw / sh;
    const dAspect = dw / dh;
    let sx = 0;
    let sy = 0;
    let cw = sw;
    let ch = sh;
    if (sAspect > dAspect) {
      cw = sh * dAspect;
      sx = (sw - cw) / 2;
    } else {
      ch = sw / dAspect;
      sy = (sh - ch) / 2;
    }
    ctx.drawImage(el, sx, sy, cw, ch, dx, dy, dw, dh);
  }
  ctx.restore();
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  c: VisualClip,
  label: string,
) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  roundRectPath(ctx, c.x, c.y, c.width, c.height, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `600 ${Math.max(18, c.width * 0.06)}px "Noto Sans KR", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, c.x + c.width / 2, c.y + c.height / 2);
  ctx.textAlign = "left";
  ctx.restore();
}

/* ───────── 도형 ───────── */

function drawShape(ctx: CanvasRenderingContext2D, c: ShapeClip) {
  ctx.fillStyle = c.fill;
  if (c.shape === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      c.x + c.width / 2,
      c.y + c.height / 2,
      c.width / 2,
      c.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    if (c.stroke && c.stroke.width > 0) {
      ctx.strokeStyle = c.stroke.color;
      ctx.lineWidth = c.stroke.width;
      ctx.stroke();
    }
  } else {
    roundRectPath(ctx, c.x, c.y, c.width, c.height, c.radius);
    ctx.fill();
    if (c.stroke && c.stroke.width > 0) {
      ctx.strokeStyle = c.stroke.color;
      ctx.lineWidth = c.stroke.width;
      ctx.stroke();
    }
  }
}

/* ───────── 공용 ───────── */

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
