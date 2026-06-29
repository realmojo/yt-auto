/** 씬 컴포넌트: 인트로(졸라맨+주유소 애니) / 개념(일러스트+켄번스+졸라맨이 가리킴) */
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Stickman, type Pose } from "./Stickman";
import { Illustration, pickIllustration } from "./illustrations";
import { FONT } from "./font";

const PALETTE = [
  ["#fff7ed", "#ffedd5"],
  ["#eff6ff", "#dbeafe"],
  ["#f0fdf4", "#dcfce7"],
  ["#fdf4ff", "#fae8ff"],
  ["#fff1f2", "#ffe4e6"],
  ["#eef2ff", "#e0e7ff"],
];

function blinkOf(frame: number) {
  const p = frame % 110;
  return p < 6 ? 1 - Math.abs(p - 3) / 3 : 0;
}

/** 부드러운 배경 + 미세 켄번스(천천히 확대/이동) + 비네팅 */
const SceneBg: React.FC<{ index: number; durFrames: number }> = ({ index, durFrames }) => {
  const frame = useCurrentFrame();
  const [a, b] = PALETTE[index % PALETTE.length];
  const scale = interpolate(frame, [0, durFrames], [1.04, 1.12], { extrapolateRight: "clamp" });
  const drift = interpolate(frame, [0, durFrames], [0, -22], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: a }}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale}) translateY(${drift}px)`,
          background: `radial-gradient(120% 100% at 28% 18%, ${a} 0%, ${b} 100%)`,
        }}
      />
      {/* 도트 패턴(은은) */}
      <AbsoluteFill
        style={{
          opacity: 0.06,
          backgroundImage: "radial-gradient(#1f2937 2px, transparent 2px)",
          backgroundSize: "44px 44px",
        }}
      />
      <AbsoluteFill style={{ boxShadow: "inset 0 0 280px rgba(0,0,0,0.12)" }} />
    </AbsoluteFill>
  );
};

const TitleCard: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const clean = title
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .replace(/\(?\s*\d{1,2}:\d{2}\s*[~\-–—]?\s*\d{0,2}:?\d{0,2}\s*\)?/g, "")
    .replace(/\s*[—–-]\s*$/, "")
    .replace(/^[\s\d.]*/, "")
    .trim();
  const y = interpolate(frame, [0, 16], [-50, 0], { extrapolateRight: "clamp" });
  const op = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        left: 80,
        transform: `translateY(${y}px)`,
        opacity: op,
        background: "#111827",
        color: "#fff",
        padding: "16px 34px",
        borderRadius: 18,
        fontFamily: FONT,
        fontSize: Math.round(width * 0.03),
        boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
        maxWidth: "76%",
      }}
    >
      {clean}
    </div>
  );
};

export const ConceptScene: React.FC<{
  index: number;
  title: string;
  text: string;
  pose: Pose;
  durFrames: number;
}> = ({ index, title, text, durFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const bob = Math.sin(frame / 14) * 5;
  const enter = interpolate(frame, [4, 22], [160, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const kind = pickIllustration(title, text);
  return (
    <AbsoluteFill>
      <SceneBg index={index} durFrames={durFrames} />
      <TitleCard title={title} />
      {/* 일러스트 — 좌측~중앙, 크게 */}
      <div
        style={{
          position: "absolute",
          left: width * 0.1,
          top: "52%",
          transform: "translateY(-50%) scale(1.5)",
          transformOrigin: "left center",
        }}
      >
        <Illustration kind={kind} />
      </div>
      {/* 졸라맨 — 우측, 좌측 일러스트를 가리키도록 좌우반전 */}
      <div
        style={{
          position: "absolute",
          right: width * 0.06,
          bottom: height * 0.1,
          transform: `translateX(${enter}px) scaleX(-1)`,
        }}
      >
        <Stickman pose="point" blink={blinkOf(frame)} bob={bob} width={width * 0.19} />
      </div>
    </AbsoluteFill>
  );
};

/** 인트로 — 주유소 일러스트 + 졸라맨 등장, "영상형" 구간 */
export const IntroScene: React.FC<{
  index: number;
  title: string;
  text: string;
  pose: Pose;
  durFrames: number;
}> = ({ index, title, text, pose, durFrames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const bob = Math.sin(frame / 10) * 9;
  const pop = interpolate(frame, [0, 20], [0.7, 1], { extrapolateRight: "clamp" });
  const kind = pickIllustration(title, text);
  return (
    <AbsoluteFill>
      <SceneBg index={index ?? 0} durFrames={durFrames} />
      <TitleCard title={title} />
      <div
        style={{
          position: "absolute",
          left: width * 0.1,
          top: "52%",
          transform: "translateY(-50%) scale(1.5)",
          transformOrigin: "left center",
        }}
      >
        <Illustration kind={kind} />
      </div>
      <div
        style={{
          position: "absolute",
          right: width * 0.07,
          bottom: height * 0.08,
          transform: `scale(${pop}) scaleX(-1)`,
        }}
      >
        <Stickman pose={pose} blink={blinkOf(frame)} bob={bob} width={width * 0.22} />
      </div>
    </AbsoluteFill>
  );
};
