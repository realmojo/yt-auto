"use client";

import { useEffect, useReducer } from "react";

/** 소스 오디오의 구간별 최대 진폭(0..1) */
export interface Waveform {
  peaks: Float32Array;
  duration: number; // 소스 길이(초)
}

interface AssetLike {
  id: string;
  url: string;
  kind: "image" | "video" | "audio";
}

const BPS = 60; // 초당 버킷 수
const MAX_BUCKETS = 24000;

const cache = new Map<string, Waveform>();
const pending = new Set<string>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

let audioCtx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!audioCtx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioCtx = new AC();
  }
  return audioCtx;
}

function notify() {
  listeners.forEach((l) => l());
}

export function peekWaveform(assetId: string): Waveform | null {
  return cache.get(assetId) ?? null;
}

/** 캐시에 없으면 디코드를 시작하고 null 반환 (완료 시 subscribe 콜백으로 통지) */
export function ensureWaveform(asset: AssetLike): Waveform | null {
  const cached = cache.get(asset.id);
  if (cached) return cached;
  if (asset.kind !== "audio" && asset.kind !== "video") return null;
  if (failed.has(asset.id) || pending.has(asset.id)) return null;
  pending.add(asset.id);
  void decode(asset.id, asset.url);
  return null;
}

async function decode(id: string, url: string): Promise<void> {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const audio = await getCtx().decodeAudioData(buf);
    cache.set(id, computePeaks(audio));
  } catch {
    failed.add(id); // 오디오 트랙이 없거나 디코드 불가 → 파형 없음
  } finally {
    pending.delete(id);
    notify();
  }
}

function computePeaks(audio: AudioBuffer): Waveform {
  const duration = audio.duration || 0;
  const buckets = Math.max(
    1,
    Math.min(MAX_BUCKETS, Math.ceil(duration * BPS) || 1),
  );
  const peaks = new Float32Array(buckets);
  const channels = audio.numberOfChannels;
  for (let ch = 0; ch < channels; ch++) {
    const data = audio.getChannelData(ch);
    const perBucket = data.length / buckets;
    for (let b = 0; b < buckets; b++) {
      const s = Math.floor(b * perBucket);
      const e = Math.min(data.length, Math.floor((b + 1) * perBucket));
      let max = 0;
      for (let i = s; i < e; i++) {
        const v = data[i] < 0 ? -data[i] : data[i];
        if (v > max) max = v;
      }
      if (max > peaks[b]) peaks[b] = max; // 채널 간 최대
    }
  }
  return { peaks, duration };
}

/** 에셋 파형을 구독 — 준비되면 컴포넌트를 리렌더한다 */
export function useWaveform(asset?: AssetLike | null): Waveform | null {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const id = asset?.id;
  useEffect(() => {
    if (!asset || !id) return;
    if (peekWaveform(id)) return;
    ensureWaveform(asset);
    const onReady = () => {
      if (peekWaveform(id)) force();
    };
    listeners.add(onReady);
    return () => {
      listeners.delete(onReady);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return id ? peekWaveform(id) : null;
}
