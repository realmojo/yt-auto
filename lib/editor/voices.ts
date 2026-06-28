"use client";

import { useCallback, useEffect, useState } from "react";

/** macOS say 한국어 음성의 성별(확실한 것만 라벨, 나머지는 무라벨로 둠) */
export const VOICE_GENDER: Record<string, "남성" | "여성"> = {
  Yuna: "여성",
  Minsu: "남성",
};

// GET 실패 시 폴백 — 한국어가 기본 설치된 음성은 유나뿐.
// (Grandpa·Reed 등 다른 음성은 목록엔 있어도 한국어 데이터를 받아야 발음됨)
export const DEFAULT_KO_VOICES = ["Yuna"];

/** 드롭다운 표시용 라벨 (예: "유나 (여성)", "Grandpa (남성)") */
export function voiceLabel(name: string): string {
  const ko = name === "Yuna" ? "유나" : name;
  const g = VOICE_GENDER[name];
  return g ? `${ko} (${g})` : ko;
}

function order(name: string): number {
  if (name === "Yuna") return 0;
  if (VOICE_GENDER[name] === "남성") return 1;
  if (VOICE_GENDER[name] === "여성") return 2;
  return 3;
}

/**
 * 설치된 한국어 say 음성 목록 — 실제로 한국어를 발음하는 음성만.
 * refresh() 로 새로 다운로드한 음성을 다시 감지(서버 캐시 무시).
 */
export function useKoreanVoices(): {
  voices: string[];
  refreshing: boolean;
  refresh: () => void;
} {
  const [voices, setVoices] = useState<string[]>(DEFAULT_KO_VOICES);
  const [refreshing, setRefreshing] = useState(false);

  const apply = useCallback((d: { voices?: string[] } | null) => {
    if (Array.isArray(d?.voices) && d.voices.length) {
      const uniq = [...new Set<string>(d.voices)];
      uniq.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
      setVoices(uniq);
    }
  }, []);

  // 초기 로드 (effect 본문에서 동기 setState 하지 않음 — 결과는 promise 콜백에서 반영)
  useEffect(() => {
    let alive = true;
    fetch("/api/tts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) apply(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [apply]);

  // 새로 다운로드한 음성 재감지 (서버 캐시 무시)
  const refresh = useCallback(() => {
    setRefreshing(true);
    fetch("/api/tts?refresh=1")
      .then((r) => (r.ok ? r.json() : null))
      .then(apply)
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [apply]);

  return { voices, refreshing, refresh };
}
