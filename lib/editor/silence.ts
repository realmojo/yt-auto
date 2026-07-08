"use client";

/**
 * 음성(오디오/영상 트랙)에서 "말하는 구간"만 골라내는 무음 감지.
 * 브라우저에서 소스를 디코드해 20ms 프레임 RMS 로 무음/발화를 판별하고,
 * 짧은 무음은 이어 붙여(끊김 방지) 발화 구간 목록(소스 절대시간, 초)을 돌려준다.
 */

export interface Segment {
  start: number;
  end: number;
}

export interface SilenceOptions {
  /** 진폭(RMS) 임계값 0..1 — 이하이면 무음. 기본 0.02 */
  threshold?: number;
  /** 이 길이 이상 조용해야 무음으로 자른다(초). 기본 0.35 */
  minSilence?: number;
  /** 이보다 짧은 발화 조각은 버린다(초). 기본 0.12 */
  minSpeech?: number;
  /** 발화 구간 앞뒤 여유(초) — 말이 잘리지 않게. 기본 0.08 */
  pad?: number;
}

let ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

/** url(오디오/영상 blob 또는 프록시)에서 발화 구간을 감지 */
export async function detectSpeechSegments(
  url: string,
  opts: SilenceOptions = {},
): Promise<{ segments: Segment[]; duration: number }> {
  const threshold = opts.threshold ?? 0.02;
  const minSilence = opts.minSilence ?? 0.35;
  const minSpeech = opts.minSpeech ?? 0.12;
  const pad = opts.pad ?? 0.08;

  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  const audio = await getCtx().decodeAudioData(arr);
  const duration = audio.duration || 0;
  const sr = audio.sampleRate;

  const chs = audio.numberOfChannels;
  const data: Float32Array[] = [];
  for (let c = 0; c < chs; c++) data.push(audio.getChannelData(c));
  const n = data[0].length;

  // 20ms 프레임 RMS(채널 평균) → 발화 여부
  const frame = Math.max(1, Math.floor(sr * 0.02));
  const nFrames = Math.ceil(n / frame);
  const loud = new Uint8Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const s = f * frame;
    const e = Math.min(n, s + frame);
    let sum = 0;
    let cnt = 0;
    for (let c = 0; c < chs; c++) {
      const d = data[c];
      for (let i = s; i < e; i++) {
        sum += d[i] * d[i];
        cnt++;
      }
    }
    const rms = cnt ? Math.sqrt(sum / cnt) : 0;
    loud[f] = rms > threshold ? 1 : 0;
  }

  const frameSec = frame / sr;
  const minSilenceFrames = Math.max(1, Math.round(minSilence / frameSec));

  // 발화 프레임을 구간으로 묶되, minSilence 미만의 짧은 무음은 이어 붙인다
  const raw: Segment[] = [];
  let i = 0;
  while (i < nFrames) {
    if (!loud[i]) {
      i++;
      continue;
    }
    let j = i;
    let lastLoud = i;
    let silenceRun = 0;
    while (j < nFrames) {
      if (loud[j]) {
        lastLoud = j;
        silenceRun = 0;
      } else if (++silenceRun >= minSilenceFrames) {
        break;
      }
      j++;
    }
    raw.push({ start: i * frameSec, end: (lastLoud + 1) * frameSec });
    i = j + 1;
  }

  // 앞뒤 여유 → 최소 발화 길이 필터 → 겹치면 병합
  const padded = raw
    .map((s) => ({ start: Math.max(0, s.start - pad), end: Math.min(duration, s.end + pad) }))
    .filter((s) => s.end - s.start >= minSpeech);
  const merged: Segment[] = [];
  for (const s of padded) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return { segments: merged, duration };
}
