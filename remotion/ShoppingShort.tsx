/**
 * 유튜브 쇼핑 쇼츠 — 세로 1080x1920.
 * 상품 이미지(Ken Burns 줌/팬) + 장면별 한국어 자막 + 내레이션 오디오(+ 선택 BGM).
 * 데이터는 inputProps.short(= short.json)로 주입한다. 폰트는 Do Hyeon(font.ts).
 */
import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FONT } from "./font";

export type Scene = { caption: string; start: number; end: number };
export type Short = {
  fps: number;
  width: number;
  height: number;
  durationFrames: number;
  durationSec: number;
  video?: string | null; // 배경 영상 staticFile 이름 (예: "source.mp4") — 있으면 우선
  image?: string | null; // 배경 이미지 staticFile 이름 (video 없을 때 Ken Burns)
  audio: string; // "narration.mp3"
  bgm?: string | null;
  bgmVolume?: number;
  title?: string;
  cta?: string;
  hashtags?: string[];
  scenes: Scene[];
};

/** 자막 가독성용 상/하단 그라데이션 */
const Scrim: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.72) 100%)",
    }}
  />
);

/** 배경 영상 — 세로 화면 커버, 원본 오디오 음소거.
 *  (소스는 make-short 에서 내레이션 길이에 맞춰 loop+crop 처리되어 들어온다) */
const VideoBackground: React.FC<{ src: string }> = ({ src }) => (
  <AbsoluteFill style={{ backgroundColor: "#0b0f19", overflow: "hidden" }}>
    <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    <Scrim />
  </AbsoluteFill>
);

const HILITE = /(\d[\d,]*원|\d+(?:\.\d+)?%|\d+(?:개|배|위|시간|분|초|일|년|만|천|명)|무료|최저가|역대급|단독|한정|초특가)/g;

/** 한 줄 폭을 em 단위로 근사(폰트 없이) — 한글/한자≈1.0, 공백≈0.34, 영숫자≈0.58.
 * 실제 측정 대신 근사해 자막을 한 줄 폭에 맞춰 나누기 위한 계산에 쓴다. */
function estLineWidthEm(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += 0.34;
    else if (/[ᄀ-ᇿ㄰-㆏가-힣぀-ヿ一-鿿]/.test(ch)) w += 1.0;
    else if (/[.,!?~·・…'"]/.test(ch)) w += 0.4;
    else if (/[a-zA-Z0-9]/.test(ch)) w += 0.58;
    else w += 0.6;
  }
  return w;
}

/** 긴 자막을 "한 줄에 들어가는" 조각들로 균형 있게 분할(단어 단위, 글자 크기는 유지).
 * 한 줄에 다 들어가면 그대로 1개. 넘치면 필요한 개수로 나눠 순차 표시한다. */
function chunkCaption(text: string, maxEm: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [text];
  const SP = 0.34;
  const em = words.map(estLineWidthEm);
  const totalEm = em.reduce((a, b) => a + b, 0) + SP * (words.length - 1);
  if (totalEm <= maxEm) return [text]; // 한 줄에 다 들어감 → 나누지 않음
  const count = Math.max(2, Math.ceil(totalEm / maxEm));
  const target = totalEm / count; // 조각들을 균형 있게
  const chunks: string[] = [];
  let cur: string[] = [];
  let curEm = 0;
  for (let i = 0; i < words.length; i++) {
    const add = (cur.length ? SP : 0) + em[i];
    const overflow = cur.length > 0 && curEm + add > maxEm;
    const balanced = cur.length > 0 && curEm >= target && chunks.length < count - 1;
    if (overflow || balanced) {
      chunks.push(cur.join(" "));
      cur = [words[i]];
      curEm = em[i];
    } else {
      cur.push(words[i]);
      curEm += add;
    }
  }
  if (cur.length) chunks.push(cur.join(" "));
  return chunks;
}

function renderCaption(text: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(HILITE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    out.push(
      <span key={i} style={{ color: "#fde047" }}>
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 상품 이미지 배경 — 전체 화면 커버 + 느린 Ken Burns */
const KenBurnsImage: React.FC<{ src: string; totalFrames: number }> = ({ src, totalFrames }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, totalFrames], [1.08, 1.24], { extrapolateRight: "clamp" });
  const ty = interpolate(frame, [0, totalFrames], [-16, 16], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0f19", overflow: "hidden" }}>
      <Img
        src={src}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateY(${ty}px)`,
        }}
      />
      {/* 자막 가독성용 상/하단 그라데이션 */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.78) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

const Caption: React.FC<{ scenes: Scene[] }> = ({ scenes }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const idx = scenes.findIndex((s) => t >= s.start && t < s.end);
  if (idx < 0) return null;
  const s = scenes[idx];
  // 흰색 자막 + 두꺼운 검정 외곽선 + 살짝 그림자(레퍼런스 썸네일 스타일) — 화면 정중앙
  const st = Math.max(3, Math.round(width * 0.0075)); // 외곽선 두께
  const outline = [
    // 8방향으로 촘촘히 깔아 매끈한 두꺼운 검정 테두리
    `-${st}px 0 0 #000`,
    `${st}px 0 0 #000`,
    `0 -${st}px 0 #000`,
    `0 ${st}px 0 #000`,
    `-${st}px -${st}px 0 #000`,
    `${st}px -${st}px 0 #000`,
    `-${st}px ${st}px 0 #000`,
    `${st}px ${st}px 0 #000`,
    // 살짝 떨어지는 부드러운 그림자
    `0 ${Math.round(st * 1.3)}px ${Math.round(st * 2.2)}px rgba(0,0,0,0.55)`,
  ].join(", ");
  // 글자 크기는 고정(줄이지 않음). 한 줄에 안 들어가면 여러 조각으로 나눠 순차 표시.
  const base = Math.round(width * 0.072);
  const maxEm = (width - 140) / base / 1.04; // 한 조각이 넘지 않을 em 폭
  const capText = s.caption.replace(/\s*\n\s*/g, " ").trim();
  const chunks = chunkCaption(capText, maxEm);
  const dur = Math.max(0.0001, s.end - s.start);
  const seg = dur / chunks.length; // 장면 시간을 조각 수로 등분
  const local = t - s.start;
  const ci = Math.min(chunks.length - 1, Math.max(0, Math.floor(local / seg)));
  // 각 조각이 나타날 때 살짝 팝인
  const inFrames = (local - ci * seg) * fps;
  const pop = interpolate(inFrames, [0, 7], [0.92, 1], { extrapolateRight: "clamp" });
  const rise = interpolate(inFrames, [0, 7], [26, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 60px" }}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: base,
          lineHeight: 1.28,
          color: "#ffffff",
          textAlign: "center",
          fontWeight: 900,
          textShadow: outline,
          transform: `scale(${pop}) translateY(${rise}px)`,
          whiteSpace: "nowrap", // 한 줄 고정
        }}
      >
        {renderCaption(chunks[ci])}
      </div>
    </AbsoluteFill>
  );
};

/** 인트로 타이틀 배지 (앞 2.2초) */
const TitleBadge: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const dur = Math.round(fps * 2.2);
  const op = interpolate(frame, [0, 8, dur - 8, dur], [0, 1, 1, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 150 }}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: Math.round(width * 0.058),
          color: "#0b0f19",
          background: "#fde047",
          padding: "16px 34px",
          borderRadius: 999,
          opacity: op,
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          maxWidth: "88%",
          textAlign: "center",
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};

/** 아웃트로 CTA (마지막 2.6초) */
const CtaOverlay: React.FC<{ cta: string; startFrame: number }> = ({ cta, startFrame }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const local = frame - startFrame;
  const op = interpolate(local, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pop = interpolate(local, [0, 12], [0.9, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: op }}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: Math.round(width * 0.08),
          color: "#0b0f19",
          background: "#ffffff",
          padding: "26px 46px",
          borderRadius: 28,
          textAlign: "center",
          transform: `scale(${pop})`,
          boxShadow: "0 16px 44px rgba(0,0,0,0.4)",
          maxWidth: "86%",
        }}
      >
        {cta}
      </div>
    </AbsoluteFill>
  );
};

export const ShoppingShortComp: React.FC<{ short: Short }> = ({ short }) => {
  const { fps } = useVideoConfig();
  const ctaStart = short.cta ? Math.max(0, short.durationFrames - Math.round(fps * 2.6)) : short.durationFrames;
  return (
    <AbsoluteFill>
      {short.video ? (
        <VideoBackground src={staticFile(short.video)} />
      ) : short.image ? (
        <KenBurnsImage src={staticFile(short.image)} totalFrames={short.durationFrames} />
      ) : (
        <AbsoluteFill style={{ backgroundColor: "#0b0f19" }} />
      )}
      <Caption scenes={short.scenes} />
      {short.title ? <TitleBadge title={short.title} /> : null}
      {short.cta ? <CtaOverlay cta={short.cta} startFrame={ctaStart} /> : null}
      <Audio src={staticFile(short.audio)} />
      {short.bgm ? <Audio src={staticFile(short.bgm)} volume={short.bgmVolume ?? 0.12} /> : null}
    </AbsoluteFill>
  );
};
