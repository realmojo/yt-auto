/**
 * 개념 일러스트 — 내레이션 내용을 화면으로 보여주는 SVG 모션그래픽.
 * 각 컴포넌트는 useCurrentFrame 으로 가볍게 움직인다(카운트·등장·강조).
 */
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT } from "./font";

const INK = "#1f2937";
const RED = "#ef4444";
const GREEN = "#10b981";
const BLUE = "#3b82f6";
const GOLD = "#f59e0b";

const label = (size: number, color = INK, weight = 400): React.CSSProperties => ({
  fontFamily: FONT,
  fontSize: size,
  color,
  fontWeight: weight,
});

/** 등장 스프링 (0→1) */
function useEnter(delay = 0) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 14 }, durationInFrames: 22 });
}

/** 주유소 + 가격 보드 */
export const GasStation: React.FC = () => {
  const e = useEnter();
  const frame = useCurrentFrame();
  const sway = Math.sin(frame / 22) * 2;
  return (
    <svg width={560} height={520} viewBox="0 0 560 520" style={{ transform: `scale(${e})` }}>
      {/* 캐노피 */}
      <rect x="40" y="60" width="420" height="40" rx="8" fill={BLUE} />
      <rect x="60" y="100" width="14" height="300" fill="#94a3b8" />
      <rect x="426" y="100" width="14" height="300" fill="#94a3b8" />
      {/* 가격보드 */}
      <rect x="150" y="120" width="220" height="150" rx="14" fill="#0f172a" />
      <text x="260" y="170" textAnchor="middle" style={label(34, "#fbbf24")}>휘발유</text>
      <text x="260" y="230" textAnchor="middle" style={label(56, "#fde68a")}>1928원</text>
      {/* 주유기 */}
      <g transform={`translate(${300 + sway},300)`}>
        <rect x="0" y="0" width="90" height="150" rx="12" fill="#ef4444" />
        <rect x="14" y="18" width="62" height="40" rx="6" fill="#fff" />
        <circle cx="45" cy="92" r="14" fill="#fff" />
        <path d="M90,40 q40,0 40,40 l0,40" stroke="#111" strokeWidth="8" fill="none" />
      </g>
      <rect x="40" y="450" width="480" height="14" rx="6" fill="#cbd5e1" />
    </svg>
  );
};

/** 두 가격 비교: 전쟁 전 1500원(기준) vs 지금 1900원(비쌈) — 앵커링 */
export const PriceCompare: React.FC = () => {
  const e1 = useEnter(0);
  const e2 = useEnter(10);
  const Card = (x: number, e: number, top: string, price: string, c: string, tag: string) => (
    <g transform={`translate(${x},${interpolate(e, [0, 1], [40, 0])})`} opacity={e}>
      <rect x="0" y="40" width="220" height="220" rx="20" fill="#fff" stroke={c} strokeWidth="6" />
      <text x="110" y="100" textAnchor="middle" style={label(30, INK)}>{top}</text>
      <text x="110" y="180" textAnchor="middle" style={label(62, c, 700)}>{price}</text>
      <rect x="50" y="210" width="120" height="40" rx="20" fill={c} />
      <text x="110" y="238" textAnchor="middle" style={label(24, "#fff")}>{tag}</text>
    </g>
  );
  return (
    <svg width={520} height={320} viewBox="0 0 520 320">
      {Card(10, e1, "전쟁 전", "1500원", GREEN, "기준점")}
      {Card(280, e2, "지금", "1900원", RED, "비싸!")}
    </svg>
  );
};

/** 숫자 카운트 다운 2000 → 1900 (−150원) — 인하 체감 */
export const PriceDrop: React.FC = () => {
  const frame = useCurrentFrame();
  const v = Math.round(interpolate(frame, [10, 45], [2000, 1850], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const e = useEnter();
  return (
    <svg width={460} height={300} viewBox="0 0 460 300" style={{ transform: `scale(${e})` }}>
      <rect x="30" y="60" width="400" height="160" rx="24" fill="#0f172a" />
      <text x="230" y="170" textAnchor="middle" style={label(96, "#fde68a", 700)}>{v}원</text>
      <g transform="translate(360,40)" opacity={interpolate(frame, [30, 45], [0, 1], { extrapolateRight: "clamp" })}>
        <path d="M0,0 l24,0 l-12,28 z" fill={GREEN} />
        <text x="12" y="-10" textAnchor="middle" style={label(28, GREEN, 700)}>-150</text>
      </g>
    </svg>
  );
};

/** 베버 법칙: 2000원 큰 막대에서 150원(7.5%)은 작은 조각 */
export const WeberBar: React.FC = () => {
  const e = useEnter();
  const w = interpolate(e, [0, 1], [0, 360]);
  return (
    <svg width={460} height={320} viewBox="0 0 460 320">
      <text x="50" y="60" style={label(30, INK)}>2000원</text>
      <rect x="50" y="80" width={w} height="90" rx="10" fill={BLUE} />
      {/* 150원 조각 */}
      <rect x={50 + w - (360 * 150) / 2000} y="80" width={(360 * 150) / 2000} height="90" rx="4" fill={RED} opacity={e} />
      <text x="50" y="230" style={label(28, RED, 700)}>150원 = 겨우 7.5%</text>
      <text x="50" y="280" style={label(26, "#64748b")}>→ 작게 느껴진다</text>
    </svg>
  );
};

/** 손실회피: 저울 — 손실 쪽이 더 무겁게(아래로) */
export const LossScale: React.FC = () => {
  const frame = useCurrentFrame();
  const e = useEnter();
  const tilt = interpolate(spring({ frame, fps: 30, config: { damping: 10 }, durationInFrames: 30 }), [0, 1], [0, 10]);
  return (
    <svg width={480} height={340} viewBox="0 0 480 340" style={{ transform: `scale(${e})` }}>
      <rect x="232" y="80" width="16" height="220" fill="#94a3b8" />
      <rect x="150" y="300" width="180" height="16" rx="8" fill="#94a3b8" />
      <g transform={`rotate(${tilt} 240 90)`}>
        <line x1="90" y1="90" x2="390" y2="90" stroke="#94a3b8" strokeWidth="10" />
        {/* 이득(가벼움) */}
        <g transform="translate(90,90)">
          <line x1="0" y1="0" x2="0" y2="40" stroke="#94a3b8" strokeWidth="6" />
          <ellipse cx="0" cy="55" rx="55" ry="16" fill={GREEN} opacity="0.85" />
          <text x="0" y="100" textAnchor="middle" style={label(26, GREEN, 700)}>이득 ↑</text>
        </g>
        {/* 손실(무거움) */}
        <g transform="translate(390,90)">
          <line x1="0" y1="0" x2="0" y2="70" stroke="#94a3b8" strokeWidth="6" />
          <ellipse cx="0" cy="85" rx="60" ry="18" fill={RED} />
          <text x="0" y="130" textAnchor="middle" style={label(28, RED, 700)}>손실 ×2</text>
        </g>
      </g>
    </svg>
  );
};

/** 요약 체크리스트 (클로징) */
export const Summary: React.FC = () => {
  const items = ["준거점·앵커링", "쾌락 적응", "베버의 법칙", "손실회피"];
  const frame = useCurrentFrame();
  return (
    <svg width={560} height={420} viewBox="0 0 560 420">
      {items.map((it, i) => {
        const op = interpolate(frame, [i * 10, i * 10 + 14], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const x = interpolate(op, [0, 1], [-30, 0]);
        return (
          <g key={i} transform={`translate(${40 + x},${40 + i * 90})`} opacity={op}>
            <circle cx="20" cy="20" r="22" fill={GREEN} />
            <path d="M10,20 l7,8 l14,-16" stroke="#fff" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <text x="60" y="32" style={label(40, INK)}>{it}</text>
          </g>
        );
      })}
    </svg>
  );
};

export type IllustrationKey =
  | "gas"
  | "compare"
  | "drop"
  | "weber"
  | "loss"
  | "summary"
  | "none";

export const Illustration: React.FC<{ kind: IllustrationKey }> = ({ kind }) => {
  switch (kind) {
    case "gas":
      return <GasStation />;
    case "compare":
      return <PriceCompare />;
    case "drop":
      return <PriceDrop />;
    case "weber":
      return <WeberBar />;
    case "loss":
      return <LossScale />;
    case "summary":
      return <Summary />;
    default:
      return null;
  }
};

/** 씬 선택 — 제목 우선(예고 문장의 키워드 오염 방지), 그다음 본문 보조 */
export function pickIllustration(title: string, text: string): IllustrationKey {
  const h = title.toLowerCase();
  if (/오프닝|후킹|훅|인트로/.test(h)) return "gas";
  if (/베버/.test(h)) return "weber";
  if (/손실회피|손실/.test(h)) return "loss";
  if (/적응/.test(h)) return "drop";
  if (/앵커|준거|전쟁\s*전|비싸/.test(h)) return "compare";
  if (/클로징|정리|요약|마무리/.test(h)) return "summary";
  // 제목으로 못 정하면 본문 보조
  const b = text.toLowerCase();
  if (/손실회피|오를 때|내릴 때/.test(b)) return "loss";
  if (/베버|7\.5%|작은 변화/.test(b)) return "weber";
  if (/적응|익숙/.test(b)) return "drop";
  if (/준거|앵커|전쟁 전|1500원/.test(b)) return "compare";
  return "gas";
}
