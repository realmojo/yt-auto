/** 화면 하단 자막 — 현재 시각의 대사 한 줄, 숫자·핵심어 하이라이트 */
import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { FONT } from "./font";

export type Line = { text: string; start: number; end: number };

const HILITE =
  /(\d[\d,]*원|\d+(?:\.\d+)?%|\d+배|준거점|앵커링|쾌락\s*적응|베버의?\s*법칙|손실회피|기준점)/g;

function render(text: string) {
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

export const Subtitles: React.FC<{ lines: Line[] }> = ({ lines }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const idx = lines.findIndex((l) => t >= l.start && t < l.end);
  if (idx < 0) return null;
  const active = lines[idx];
  const local = (t - active.start) * fps;
  const pop = interpolate(local, [0, 6], [0.96, 1], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        bottom: 72,
        left: 0,
        width: "100%",
        display: "flex",
        justifyContent: "center",
        padding: "0 140px",
      }}
    >
      <span
        style={{
          fontFamily: FONT,
          fontSize: Math.round(width * 0.03),
          color: "#ffffff",
          background: "rgba(15,23,42,0.82)",
          padding: "12px 30px",
          borderRadius: 16,
          lineHeight: 1.4,
          textAlign: "center",
          transform: `scale(${pop})`,
          boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
          maxWidth: "84%",
        }}
      >
        {render(active.text)}
      </span>
    </div>
  );
};
