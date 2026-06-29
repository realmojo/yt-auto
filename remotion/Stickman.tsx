/**
 * 졸라맨(스틱피겨) 캐릭터 — 포즈세트.
 * 모든 컷에서 동일한 캐릭터를 보장하기 위해 AI 이미지가 아닌 SVG 컴포넌트로 그린다.
 * pose 로 자세를 고르고, blink/bob 같은 미세 애니메이션은 Remotion 프레임으로 준다.
 */
import React from "react";

export type Pose =
  | "idle"
  | "point" // 손가락으로 가리키기
  | "shocked" // 놀람 (양손 위로)
  | "think" // 생각 (손 턱)
  | "shrug" // 어깨 으쓱
  | "happy" // 기쁨 (양팔 벌림)
  | "sad"; // 낙담

const STROKE = 14;

/** 팔/다리 좌표를 포즈별로 정의 (머리 중심 기준 상대 좌표계, viewBox 0..200 x 0..360) */
function limbs(pose: Pose) {
  // 기본 몸통: 머리(cx=100,cy=60,r=38), 목→골반 (100,98)~(100,210)
  // 어깨 y=120, 골반 y=210
  switch (pose) {
    case "point":
      return {
        armL: "M100,130 L60,165", // 왼팔 자연
        armR: "M100,130 L165,110", // 오른팔 위로 가리킴
        legL: "M100,210 L72,300",
        legR: "M100,210 L128,300",
        hand: { x: 170, y: 106 },
      };
    case "shocked":
      return {
        armL: "M100,128 L62,80",
        armR: "M100,128 L138,80",
        legL: "M100,210 L74,300",
        legR: "M100,210 L126,300",
      };
    case "think":
      return {
        armL: "M100,132 L70,180",
        armR: "M100,130 Q120,118 104,96", // 손을 턱으로
        legL: "M100,210 L78,300",
        legR: "M100,210 L122,300",
      };
    case "shrug":
      return {
        armL: "M100,128 L66,112",
        armR: "M100,128 L134,112",
        legL: "M100,210 L76,300",
        legR: "M100,210 L124,300",
      };
    case "happy":
      return {
        armL: "M100,126 L56,92",
        armR: "M100,126 L144,92",
        legL: "M100,210 L70,300",
        legR: "M100,210 L130,300",
      };
    case "sad":
      return {
        armL: "M100,134 L74,188",
        armR: "M100,134 L126,188",
        legL: "M100,210 L84,300",
        legR: "M100,210 L116,300",
      };
    case "idle":
    default:
      return {
        armL: "M100,130 L68,172",
        armR: "M100,130 L132,172",
        legL: "M100,210 L78,300",
        legR: "M100,210 L122,300",
      };
  }
}

/** 표정 (눈/입). expression 없으면 pose 기반 기본값 */
function face(pose: Pose) {
  const mouth =
    pose === "happy"
      ? "M84,70 Q100,86 116,70" // 웃음
      : pose === "sad"
        ? "M84,80 Q100,66 116,80" // 시무룩
        : pose === "shocked"
          ? "ellipse" // 입 벌림
          : "M86,74 L114,74"; // 평소
  return { mouth };
}

export const Stickman: React.FC<{
  pose?: Pose;
  color?: string;
  /** 0..1 깜빡임(0=뜸,1=감음) */
  blink?: number;
  /** 위아래 미세 흔들림 px */
  bob?: number;
  width?: number;
}> = ({ pose = "idle", color = "#111111", blink = 0, bob = 0, width = 240 }) => {
  const L = limbs(pose);
  const f = face(pose);
  const eyeH = Math.max(1, 8 * (1 - blink));
  return (
    <svg
      width={width}
      height={(width * 360) / 200}
      viewBox="0 0 200 360"
      style={{ transform: `translateY(${bob}px)`, overflow: "visible" }}
    >
      <g
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* 머리 */}
        <circle cx="100" cy="60" r="38" fill="#ffffff" />
        {/* 몸통 */}
        <line x1="100" y1="98" x2="100" y2="210" />
        {/* 팔다리 */}
        <path d={L.armL} />
        <path d={L.armR} />
        <path d={L.legL} />
        <path d={L.legR} />
      </g>
      {/* 손가락 포인트 강조점 */}
      {"hand" in L && L.hand ? (
        <circle cx={L.hand.x} cy={L.hand.y} r="7" fill={color} />
      ) : null}
      {/* 눈 */}
      <g fill={color} stroke="none">
        <ellipse cx="86" cy="56" rx="6" ry={eyeH} />
        <ellipse cx="114" cy="56" rx="6" ry={eyeH} />
      </g>
      {/* 입 */}
      {f.mouth === "ellipse" ? (
        <ellipse
          cx="100"
          cy="76"
          rx="9"
          ry="12"
          fill="none"
          stroke={color}
          strokeWidth="6"
        />
      ) : (
        <path d={f.mouth} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
      )}
    </svg>
  );
};
