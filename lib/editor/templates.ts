import { DEFAULT_TITLE_FONT } from "./constants";
import { makeShapeClip, makeTextClip, makeUrlImageClip } from "./factory";
import type { Clip, Project } from "./types";

/** 해숏티 채널 로고 — taint 방지를 위해 같은 출처 프록시 경유 */
const HAESYOTTI_LOGO =
  "https://yt3.ggpht.com/osTlxUzYGlmuFQ5qcjHZN0xViEaRCMKT6Sqpa5KsiUFI6ezC0wU9uzy1XE-LxKrlHz_QjXtvm50=s600-c-k-c0x00ffffff-no-rj-rp-mo";
const HAESYOTTI_LOGO_SRC = `/api/proxy-image?url=${encodeURIComponent(HAESYOTTI_LOGO)}`;

export interface TemplateContext {
  W: number;
  H: number;
  textTrackId: string;
  overlayTrackId: string;
  duration: number;
}

export interface EditorTemplate {
  id: string;
  name: string;
  /** 썸네일/적용 배경 */
  background: string;
  /** 적용 시 텍스트·오버레이 트랙에 넣을 클립들 */
  build: (ctx: TemplateContext) => Clip[];
}

function titleAndSubtitle(
  ctx: TemplateContext,
  opts: {
    titleColor: string;
    subColor: string;
    subBg: string | null;
    weight?: number;
    align?: "left" | "center";
  },
): Clip[] {
  const { W, H, textTrackId, duration } = ctx;
  const align = opts.align ?? "left";
  const x = align === "center" ? Math.round(W * 0.07) : Math.round(W * 0.08);
  const width = Math.round(W * (align === "center" ? 0.86 : 0.84));
  return [
    makeTextClip(textTrackId, W, H, {
      text: "제목을\n입력하세요",
      name: "제목",
      x,
      width,
      y: Math.round(H * 0.14),
      height: Math.round(H * 0.2),
      fontSize: DEFAULT_TITLE_FONT,
      fontWeight: opts.weight ?? 800,
      color: opts.titleColor,
      align,
      vAlign: "top",
      lineHeight: 1.15,
      background: null,
      duration,
    }),
    makeTextClip(textTrackId, W, H, {
      text: "자막을 입력하세요",
      name: "자막",
      x,
      width,
      y: Math.round(H * 0.72),
      height: Math.round(H * 0.1),
      fontSize: Math.round(W * 0.04),
      fontWeight: 600,
      color: opts.subColor,
      align,
      vAlign: "middle",
      background: opts.subBg,
      duration,
    }),
  ];
}

/** 인스타그램 계정 핸들(@username) 한 줄 */
function instaHandle(
  ctx: TemplateContext,
  opts: { color: string; y?: number; align?: "left" | "center" },
): Clip {
  const { W, H, textTrackId, duration } = ctx;
  const align = opts.align ?? "center";
  return makeTextClip(textTrackId, W, H, {
    text: "@username",
    name: "@핸들",
    x: align === "center" ? Math.round(W * 0.1) : Math.round(W * 0.08),
    width: Math.round(W * (align === "center" ? 0.8 : 0.84)),
    y: opts.y ?? Math.round(H * 0.9),
    height: Math.round(H * 0.05),
    fontSize: Math.round(W * 0.03),
    fontWeight: 700,
    color: opts.color,
    align,
    vAlign: "middle",
    letterSpacing: 0.5,
    background: null,
    duration,
  });
}

export const TEMPLATES: EditorTemplate[] = [
  {
    id: "haesyotti-reels",
    name: "해숏티 릴스",
    background: "#0b0b0e",
    build: (ctx) => {
      const { W, H, textTrackId, overlayTrackId, duration } = ctx;
      const av = Math.round(W * 0.12); // 로고 한 변
      const avX = Math.round((W - av) / 2); // 상단 가운데 정렬
      const avY = Math.round(H * 0.03);
      const stroke = { color: "#000000", width: Math.round(W * 0.009) };
      return [
        // 상단 흰색 헤더 밴드
        makeShapeClip(overlayTrackId, W, H, {
          name: "헤더 배경",
          x: 0,
          y: 0,
          width: W,
          height: Math.round(H * 0.255),
          fill: "#ffffff",
          radius: 0,
          duration,
        }),
        // 프로필 로고 (상단 가운데)
        makeUrlImageClip(overlayTrackId, HAESYOTTI_LOGO_SRC, "haesyotti-logo", W, H, {
          name: "프로필 로고",
          x: avX,
          y: avY,
          width: av,
          height: av,
          radius: Math.round(av * 0.32),
          objectFit: "cover",
          duration,
        }),
        // 제목 (굵은 검정, 헤더 하단, 가운데 정렬)
        makeTextClip(textTrackId, W, H, {
          text: "제목을 입력하세요",
          name: "제목",
          x: Math.round(W * 0.06),
          y: Math.round(H * 0.155),
          width: Math.round(W * 0.88),
          height: Math.round(H * 0.06),
          fontSize: DEFAULT_TITLE_FONT,
          fontWeight: 800,
          fontFamily: '"Black Han Sans", "Noto Sans KR", sans-serif',
          color: "#111111",
          align: "center",
          vAlign: "middle",
          lineHeight: 1.15,
          background: null,
          shadow: false,
          duration,
        }),
        // 영상 중앙 자막 (흰색 + 검정 외곽선)
        makeTextClip(textTrackId, W, H, {
          text: "자막을 입력하세요",
          name: "중앙 자막",
          x: Math.round(W * 0.08),
          y: Math.round(H * 0.72),
          width: Math.round(W * 0.84),
          height: Math.round(H * 0.08),
          fontSize: Math.round(W * 0.058),
          fontWeight: 800,
          color: "#ffffff",
          align: "center",
          vAlign: "middle",
          background: null,
          shadow: true,
          stroke,
          duration,
        }),
        // 하단 흰색 푸터 밴드
        makeShapeClip(overlayTrackId, W, H, {
          name: "하단 배경",
          x: 0,
          y: Math.round(H * 0.8),
          width: W,
          height: Math.round(H * 0.2),
          fill: "#ffffff",
          radius: 0,
          duration,
        }),
        // 하단 설명 자막 (2줄, 검정 — 흰 배경 위)
        makeTextClip(textTrackId, W, H, {
          text: "하단 설명 자막을\n입력하세요",
          name: "하단 자막",
          x: Math.round(W * 0.06),
          y: Math.round(H * 0.82),
          width: Math.round(W * 0.88),
          height: Math.round(H * 0.14),
          fontSize: Math.round(W * 0.05),
          fontWeight: 800,
          color: "#111111",
          align: "center",
          vAlign: "middle",
          lineHeight: 1.25,
          background: null,
          shadow: false,
          stroke: null,
          duration,
        }),
      ];
    },
  },
  {
    id: "ig-gradient",
    name: "인스타 그라디언트",
    background: "linear-gradient(135deg,#feda75 0%,#fa7e1e 25%,#d62976 55%,#962fbf 80%,#4f5bd5 100%)",
    build: (ctx) => [
      ...titleAndSubtitle(ctx, {
        titleColor: "#ffffff",
        subColor: "#ffffff",
        subBg: "rgba(0,0,0,0.18)",
        weight: 900,
        align: "center",
      }),
      instaHandle(ctx, { color: "rgba(255,255,255,0.92)" }),
    ],
  },
  {
    id: "ig-story",
    name: "인스타 스토리",
    background: "linear-gradient(160deg,#1f2233 0%,#3a2154 100%)",
    build: (ctx) => {
      const { W, H, overlayTrackId, textTrackId, duration } = ctx;
      return [
        // 상단 스토리 진행 바
        makeShapeClip(overlayTrackId, W, H, {
          name: "스토리 바",
          x: Math.round(W * 0.06),
          y: Math.round(H * 0.04),
          width: Math.round(W * 0.88),
          height: Math.round(H * 0.006),
          fill: "rgba(255,255,255,0.85)",
          radius: 999,
          duration,
        }),
        // 프로필 동그라미
        makeShapeClip(overlayTrackId, W, H, {
          name: "프로필",
          shape: "ellipse",
          x: Math.round(W * 0.06),
          y: Math.round(H * 0.065),
          width: Math.round(W * 0.1),
          height: Math.round(W * 0.1),
          fill: "#e1306c",
          radius: 999,
          duration,
        }),
        makeTextClip(textTrackId, W, H, {
          text: "username",
          name: "사용자명",
          x: Math.round(W * 0.18),
          width: Math.round(W * 0.6),
          y: Math.round(H * 0.075),
          height: Math.round(W * 0.08),
          fontSize: Math.round(W * 0.034),
          fontWeight: 700,
          color: "#ffffff",
          align: "left",
          vAlign: "middle",
          background: null,
          duration,
        }),
        ...titleAndSubtitle(ctx, {
          titleColor: "#ffffff",
          subColor: "#e9d5ff",
          subBg: null,
          align: "center",
        }),
      ];
    },
  },
  {
    id: "ig-card",
    name: "인스타 카드",
    background: "linear-gradient(160deg,#fdf2f8 0%,#fae8ff 100%)",
    build: (ctx) => {
      const { W, H, overlayTrackId, duration } = ctx;
      return [
        // 흰 카드 배경
        makeShapeClip(overlayTrackId, W, H, {
          name: "카드",
          x: Math.round(W * 0.07),
          y: Math.round(H * 0.1),
          width: Math.round(W * 0.86),
          height: Math.round(H * 0.8),
          fill: "#ffffff",
          radius: Math.round(W * 0.05),
          duration,
        }),
        // 좌상단 포인트 점
        makeShapeClip(overlayTrackId, W, H, {
          name: "포인트",
          shape: "ellipse",
          x: Math.round(W * 0.12),
          y: Math.round(H * 0.16),
          width: Math.round(W * 0.06),
          height: Math.round(W * 0.06),
          fill: "#e1306c",
          radius: 999,
          duration,
        }),
        ...titleAndSubtitle(ctx, {
          titleColor: "#1f2937",
          subColor: "#6b7280",
          subBg: null,
          weight: 900,
          align: "left",
        }),
        instaHandle(ctx, { color: "#e1306c", align: "left", y: Math.round(H * 0.82) }),
      ];
    },
  },
  {
    id: "ig-quote",
    name: "인스타 인용",
    background: "linear-gradient(160deg,#262335 0%,#1a1726 100%)",
    build: (ctx) => {
      const { W, H, overlayTrackId, textTrackId, duration } = ctx;
      return [
        // 큰 따옴표
        makeTextClip(textTrackId, W, H, {
          text: "“",
          name: "따옴표",
          x: Math.round(W * 0.08),
          width: Math.round(W * 0.4),
          y: Math.round(H * 0.08),
          height: Math.round(H * 0.2),
          fontSize: Math.round(W * 0.26),
          fontWeight: 900,
          color: "#f9a8d4",
          align: "left",
          vAlign: "top",
          background: null,
          duration,
        }),
        // 강조 바
        makeShapeClip(overlayTrackId, W, H, {
          name: "강조 바",
          x: Math.round(W * 0.08),
          y: Math.round(H * 0.66),
          width: Math.round(W * 0.16),
          height: Math.round(H * 0.008),
          fill: "#f9a8d4",
          radius: 999,
          duration,
        }),
        makeTextClip(textTrackId, W, H, {
          text: "마음을 울리는\n한 문장을 적어보세요",
          name: "인용문",
          x: Math.round(W * 0.08),
          width: Math.round(W * 0.84),
          y: Math.round(H * 0.36),
          height: Math.round(H * 0.28),
          fontSize: Math.round(W * 0.06),
          fontWeight: 800,
          color: "#ffffff",
          align: "left",
          vAlign: "top",
          lineHeight: 1.25,
          background: null,
          duration,
        }),
        instaHandle(ctx, { color: "rgba(255,255,255,0.7)", align: "left", y: Math.round(H * 0.72) }),
      ];
    },
  },
  {
    id: "dark",
    name: "다크",
    background: "linear-gradient(160deg,#0b0b10 0%,#1a1a22 100%)",
    build: (ctx) =>
      titleAndSubtitle(ctx, {
        titleColor: "#ffffff",
        subColor: "#e5e7eb",
        subBg: "rgba(0,0,0,0.55)",
      }),
  },
  {
    id: "accent",
    name: "3 vs 4",
    background: "linear-gradient(180deg,#15161c 0%,#15161c 100%)",
    build: (ctx) => {
      const { W, H, overlayTrackId, duration } = ctx;
      return [
        makeShapeClip(overlayTrackId, W, H, {
          name: "강조 바",
          x: 0,
          y: Math.round(H * 0.42),
          width: W,
          height: Math.round(H * 0.03),
          fill: "#f97316",
          radius: 0,
          duration,
        }),
        ...titleAndSubtitle(ctx, {
          titleColor: "#ffffff",
          subColor: "#fdba74",
          subBg: null,
        }),
      ];
    },
  },
  {
    id: "blue",
    name: "블루",
    background: "linear-gradient(160deg,#4f46e5 0%,#2563eb 100%)",
    build: (ctx) =>
      titleAndSubtitle(ctx, {
        titleColor: "#ffffff",
        subColor: "#dbeafe",
        subBg: "rgba(0,0,0,0.25)",
        align: "center",
      }),
  },
  {
    id: "sunset",
    name: "선셋",
    background: "linear-gradient(160deg,#ec4899 0%,#f97316 100%)",
    build: (ctx) =>
      titleAndSubtitle(ctx, {
        titleColor: "#ffffff",
        subColor: "#fff7ed",
        subBg: "rgba(0,0,0,0.2)",
        align: "center",
      }),
  },
  {
    id: "mint",
    name: "민트",
    background: "linear-gradient(160deg,#10b981 0%,#06b6d4 100%)",
    build: (ctx) =>
      titleAndSubtitle(ctx, {
        titleColor: "#04201c",
        subColor: "#042f2e",
        subBg: "rgba(255,255,255,0.65)",
      }),
  },
  {
    id: "minimal",
    name: "미니멀",
    background: "#0f1115",
    build: (ctx) =>
      titleAndSubtitle(ctx, {
        titleColor: "#f8fafc",
        subColor: "#cbd5e1",
        subBg: null,
        weight: 700,
      }),
  },
];

/** 프로젝트에서 텍스트/오버레이 트랙 id를 찾아 템플릿 컨텍스트 생성 */
export function templateContext(project: Project): TemplateContext {
  const text = project.tracks.find((t) => t.kind === "text");
  const overlay = project.tracks.find((t) => t.kind === "overlay");
  return {
    W: project.width,
    H: project.height,
    textTrackId: text?.id ?? project.tracks[0].id,
    overlayTrackId: overlay?.id ?? text?.id ?? project.tracks[0].id,
    duration: project.duration,
  };
}
