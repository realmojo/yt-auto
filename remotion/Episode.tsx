/** 에피소드 합성 루트 컴포넌트 — episode.json(props)으로 씬·자막·내레이션을 배치 */
import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ConceptScene, IntroScene } from "./scenes";
import { Subtitles, type Line } from "./Subtitles";
import type { Pose } from "./Stickman";
import "./font";

export type Scene = {
  title: string;
  pose: Pose;
  kind: "intro" | "concept";
  start: number;
  end: number;
  lines: Line[];
};

export type Episode = {
  fps: number;
  width: number;
  height: number;
  audio: string;
  durationSec: number;
  durationFrames: number;
  scenes: Scene[];
};

/** 씬 진입/이탈 페이드 (하드컷 완화) */
const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [0, 9, dur - 9, dur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity: op }}>{children}</AbsoluteFill>;
};

export const EpisodeComp: React.FC<{ episode: Episode }> = ({ episode }) => {
  const { fps } = useVideoConfig();
  const allLines: Line[] = episode.scenes.flatMap((s) => s.lines);
  return (
    <AbsoluteFill style={{ backgroundColor: "#fff7ed" }}>
      <Audio src={staticFile(episode.audio)} />
      {episode.scenes.map((s, i) => {
        const from = Math.round(s.start * fps);
        const next = episode.scenes[i + 1];
        const until = next ? Math.round(next.start * fps) : episode.durationFrames;
        const dur = Math.max(1, until - from);
        const text = s.lines.map((l) => l.text).join(" ");
        return (
          <Sequence key={i} from={from} durationInFrames={dur} name={s.title}>
            <Fade dur={dur}>
              {s.kind === "intro" ? (
                <IntroScene index={i} title={s.title} text={text} pose={s.pose} durFrames={dur} />
              ) : (
                <ConceptScene index={i} title={s.title} text={text} pose={s.pose} durFrames={dur} />
              )}
            </Fade>
          </Sequence>
        );
      })}
      <Subtitles lines={allLines} />
    </AbsoluteFill>
  );
};
