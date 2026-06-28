"use client";

import { Loader2, RotateCw, Volume2 } from "lucide-react";
import { useState } from "react";

import { uid } from "@/lib/editor/geometry";
import { useActions } from "@/lib/editor/store";
import type { MediaAsset } from "@/lib/editor/types";
import { useKoreanVoices, voiceLabel } from "@/lib/editor/voices";

export function TtsPanel() {
  const actions = useActions();
  const { voices: voiceOptions, refreshing, refresh } = useKoreanVoices();
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("Yuna");
  const [rate, setRate] = useState(220);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const generate = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, rate }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "음성 생성에 실패했습니다.");
      }
      const url = URL.createObjectURL(await res.blob());
      const duration = await audioDuration(url);
      const asset: MediaAsset = {
        id: uid("ast"),
        kind: "audio",
        name: text.trim().slice(0, 16) || "음성",
        url,
        duration,
        width: 0,
        height: 0,
      };
      actions.addNarration(asset);
      setNotice(`음성(${Math.round(duration)}초)을 오디오 트랙에 추가했습니다.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "음성 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 텍스트 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
          음성으로 만들 텍스트
        </h4>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="음성으로 변환할 텍스트를 입력하세요. 여러 문장·줄바꿈 가능합니다."
          className="inp min-h-0 flex-1 resize-none"
        />
      </div>

      {/* 음성 / 속도 */}
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1.5">
          <span className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-slate-500">
            음성
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              title="새로 받은 음성 새로고침"
              className="text-slate-500 transition hover:text-indigo-300 disabled:opacity-50"
            >
              <RotateCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </span>
          <select value={voice} onChange={(e) => setVoice(e.target.value)} className="inp">
            {voiceOptions.map((v) => (
              <option key={v} value={v}>
                {voiceLabel(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
            속도 {rate} wpm
          </span>
          <input
            type="range"
            min={130}
            max={280}
            step={5}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="h-8 w-full"
          />
        </label>
      </div>

      <button
        onClick={generate}
        disabled={!text.trim() || busy}
        className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-[13px] font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Volume2 className="size-4" />}
        {busy ? "음성 생성 중…" : "음성 만들기 (TTS)"}
      </button>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-300">
          {notice}
        </p>
      )}

      <p className="rounded-lg border border-[#1d2845] bg-[#0a101f] p-3 text-[11px] leading-relaxed text-slate-500">
        생성한 음성은 <b className="text-slate-300">재생헤드 위치</b>의 오디오 트랙에 추가됩니다.
        타임라인에서 자르기·이동·길이 조절로 편집하세요. (macOS 음성 합성, 키·설치 불필요)
      </p>
    </div>
  );
}

/** object URL 오디오의 길이(초)를 메타데이터로 읽는다 */
function audioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => resolve(0);
    a.src = url;
  });
}
