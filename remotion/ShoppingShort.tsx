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
  const local = (t - s.start) * fps;
  const pop = interpolate(local, [0, 7], [0.92, 1], { extrapolateRight: "clamp" });
  const rise = interpolate(local, [0, 7], [26, 0], { extrapolateRight: "clamp" });
  // 흰색 자막 + 검은 외곽선(레퍼런스 스타일) — 화면 정중앙
  const stroke = Math.max(2, Math.round(width * 0.004));
  const outline = [
    `-${stroke}px -${stroke}px 0 #000`,
    `${stroke}px -${stroke}px 0 #000`,
    `-${stroke}px ${stroke}px 0 #000`,
    `${stroke}px ${stroke}px 0 #000`,
    `0 3px 10px rgba(0,0,0,0.5)`,
  ].join(", ");
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 60px" }}>
      <div
        style={{
          fontFamily: FONT,
          fontSize: Math.round(width * 0.066),
          lineHeight: 1.3,
          color: "#ffffff",
          textAlign: "center",
          fontWeight: 400,
          textShadow: outline,
          transform: `scale(${pop}) translateY(${rise}px)`,
          maxWidth: "94%",
        }}
      >
        {renderCaption(s.caption)}
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
