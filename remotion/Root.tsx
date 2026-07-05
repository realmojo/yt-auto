import React from "react";
import { Composition } from "remotion";
import { EpisodeComp, type Episode } from "./Episode";
import { ShoppingShortComp, type Short } from "./ShoppingShort";

/** 쇼핑 쇼츠 프리뷰 기본값 — 렌더 시 inputProps(short)로 덮어쓴다 */
const SHORT_FALLBACK: Short = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationSec: 6,
  durationFrames: 180,
  image: "input.jpg",
  audio: "narration.mp3",
  bgm: null,
  title: "상품 쇼츠 샘플",
  cta: "지금 확인하세요",
  hashtags: [],
  scenes: [{ caption: "short.json 을 inputProps 로 전달하세요.", start: 0, end: 6 }],
};

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
    <>
    <Composition
      id="ShoppingShort"
      component={ShoppingShortComp}
      durationInFrames={SHORT_FALLBACK.durationFrames}
      fps={SHORT_FALLBACK.fps}
      width={SHORT_FALLBACK.width}
      height={SHORT_FALLBACK.height}
      defaultProps={{ short: SHORT_FALLBACK }}
      calculateMetadata={({ props }) => {
        const s = props.short;
        return { durationInFrames: s.durationFrames, fps: s.fps, width: s.width, height: s.height };
      }}
    />
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
    </>
  );
};
