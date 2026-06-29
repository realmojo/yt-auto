import React from "react";
import { Composition } from "remotion";
import { EpisodeComp, type Episode } from "./Episode";

/** 프리뷰/렌더 기본값 — 실제 렌더 시 inputProps(episode)로 덮어쓴다 */
const FALLBACK: Episode = {
  fps: 30,
  width: 1920,
  height: 1080,
  audio: "narration.mp3",
  durationSec: 6,
  durationFrames: 180,
  scenes: [
    {
      title: "샘플",
      pose: "point",
      kind: "intro",
      start: 0,
      end: 6,
      lines: [{ text: "episode.json 을 inputProps 로 전달하세요.", start: 0, end: 6 }],
    },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Episode"
      component={EpisodeComp}
      durationInFrames={FALLBACK.durationFrames}
      fps={FALLBACK.fps}
      width={FALLBACK.width}
      height={FALLBACK.height}
      defaultProps={{ episode: FALLBACK }}
      calculateMetadata={({ props }) => {
        const e = props.episode;
        return {
          durationInFrames: e.durationFrames,
          fps: e.fps,
          width: e.width,
          height: e.height,
        };
      }}
    />
  );
};
