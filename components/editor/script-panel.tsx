"use client";

import { Captions, Copy, Loader2, Sparkles, Square, Trash2, Volume2 } from "lucide-react";
import { useRef, useState } from "react";

import { uid } from "@/lib/editor/geometry";
import { useActions } from "@/lib/editor/store";
import { scriptToSubtitleLines } from "@/lib/editor/script-to-subtitles";
import type { MediaAsset } from "@/lib/editor/types";
import { useKoreanVoices, voiceLabel } from "@/lib/editor/voices";

const TONE_OPTS: [string, string][] = [
  ["docu", "교양 다큐"],
  ["mystery", "미스터리 극화"],
  ["casual", "유쾌 유튜버"],
  ["analyst", "전문 분석가"],
  ["hyper", "하이텐션"],
];
const AUDIENCE_OPTS: [string, string][] = [
  ["general", "일반 대중"],
  ["young", "2030 청년"],
  ["middle", "4050 중장년"],
  ["senior", "60+ 시니어"],
  ["invest", "투자·재테크"],
];
const LENGTH_OPTS: [string, string][] = [
  ["3", "3분 내외"],
  ["8", "8분 내외"],
  ["12", "12분 내외"],
];

type Engine = "ollama" | "claude";

export function ScriptPanel() {
  const actions = useActions();
  const { voices: voiceOptions } = useKoreanVoices();
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState("docu");
  const [audience, setAudience] = useState("general");
  const [lengthMin, setLengthMin] = useState("8");
  const [engine, setEngine] = useState<Engine>("ollama");
  const [result, setResult] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voice, setVoice] = useState("Yuna");
  const [ttsBusy, setTtsBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const generate = async () => {
    if (!prompt.trim() || streaming) return;
    setStreaming(true);
    setError(null);
    setNotice(null);
    setResult("");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "prompt", prompt, tone, audience, lengthMin, engine }),
        signal: ac.signal,
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || ct.includes("application/json")) {
        const data = await res.json().catch(() => ({ error: `오류 (HTTP ${res.status})` }));
        throw new Error(data.error || "대본 생성에 실패했습니다.");
      }
      if (!res.body) throw new Error("스트림을 읽을 수 없습니다.");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setResult((p) => p + dec.decode(value, { stream: true }));
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        /* 사용자 중단 — 부분 결과 유지 */
      } else {
        setError(e instanceof Error ? e.message : "대본 생성에 실패했습니다.");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const insertSubtitles = () => {
    const lines = scriptToSubtitleLines(result);
    if (lines.length === 0) {
      setNotice("자막으로 넣을 발화 문장을 찾지 못했습니다.");
      return;
    }
    actions.importSubtitles(lines);
    setNotice(`자막 ${lines.length}개를 타임라인에 추가했습니다.`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setNotice("대본을 클립보드에 복사했습니다.");
    } catch {
      setNotice("복사에 실패했습니다.");
    }
  };

  const clear = () => {
    setResult("");
    setError(null);
    setNotice(null);
  };

  /** 대본 발화 → macOS say(TTS) → 오디오 트랙에 내레이션 클립으로 추가 */
  const generateNarration = async () => {
    const text = scriptToSubtitleLines(result).join(" ");
    if (!text.trim()) {
      setNotice("내레이션으로 만들 발화 문장이 없습니다.");
      return;
    }
    setTtsBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "내레이션 생성에 실패했습니다.");
      }
      const url = URL.createObjectURL(await res.blob());
      const duration = await audioDuration(url);
      const asset: MediaAsset = {
        id: uid("ast"),
        kind: "audio",
        name: "내레이션",
        url,
        duration,
        width: 0,
        height: 0,
      };
      actions.addNarration(asset);
      setNotice(`내레이션(${Math.round(duration)}초)을 오디오 트랙에 추가했습니다.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "내레이션 생성에 실패했습니다.");
    } finally {
      setTtsBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 프롬프트 */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
          영상 주제 / 요청
        </h4>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="어떤 영상인가요? 주제·핵심 메시지·참고할 내용을 자유롭게 적어주세요."
          rows={4}
          className="inp resize-none"
        />
      </div>

      {/* 옵션 */}
      <div className="grid grid-cols-3 gap-2">
        <LabeledSelect label="말투" value={tone} onChange={setTone} options={TONE_OPTS} />
        <LabeledSelect label="타겟" value={audience} onChange={setAudience} options={AUDIENCE_OPTS} />
        <LabeledSelect label="분량" value={lengthMin} onChange={setLengthMin} options={LENGTH_OPTS} />
      </div>

      {/* 엔진 */}
      <div className="space-y-1.5">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">엔진</h4>
        <div className="flex gap-2">
          <EngineBtn active={engine === "ollama"} onClick={() => setEngine("ollama")}>
            Ollama (qwen3)
          </EngineBtn>
          <EngineBtn active={engine === "claude"} onClick={() => setEngine("claude")}>
            Claude
          </EngineBtn>
        </div>
      </div>

      {/* 생성 / 중단 */}
      {streaming ? (
        <button
          onClick={stop}
          className="flex items-center justify-center gap-2 rounded-lg border border-rose-500/50 bg-rose-600/20 py-2.5 text-[13px] font-bold text-rose-200 transition hover:bg-rose-600/30"
        >
          <Square className="size-3.5" /> 생성 중단
        </button>
      ) : (
        <button
          onClick={generate}
          disabled={!prompt.trim()}
          className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-[13px] font-bold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles className="size-4" /> 대본 생성
        </button>
      )}

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

      {/* 결과 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1.5 flex items-center justify-between">
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">결과</h4>
          {streaming && (
            <span className="flex items-center gap-1 text-[10px] text-indigo-300">
              <Loader2 className="size-3 animate-spin" /> 생성 중…
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-[#1b2440] bg-[#0a101f] p-3">
          {result ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-slate-200">
              {result}
            </pre>
          ) : (
            <p className="text-[11px] leading-relaxed text-slate-600">
              생성된 대본이 여기에 표시됩니다. 완성되면 “자막으로 넣기”로 타임라인에 바로 추가할 수
              있습니다.
            </p>
          )}
        </div>
      </div>

      {/* 결과 액션 */}
      <div className="grid grid-cols-3 gap-2">
        <ActionBtn onClick={insertSubtitles} disabled={!result || streaming} icon={<Captions className="size-3.5" />}>
          자막 넣기
        </ActionBtn>
        <ActionBtn onClick={copy} disabled={!result} icon={<Copy className="size-3.5" />}>
          복사
        </ActionBtn>
        <ActionBtn onClick={clear} disabled={!result && !error} icon={<Trash2 className="size-3.5" />}>
          지우기
        </ActionBtn>
      </div>

      {/* 내레이션(TTS) */}
      <div className="flex gap-2">
        <select
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          title="음성"
          className="inp w-28 shrink-0"
        >
          {voiceOptions.map((v) => (
            <option key={v} value={v}>
              {voiceLabel(v)}
            </option>
          ))}
        </select>
        <button
          onClick={generateNarration}
          disabled={!result || streaming || ttsBusy}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-600/15 py-2 text-[12px] font-semibold text-emerald-200 transition hover:bg-emerald-600/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Volume2 className="size-3.5" />
          {ttsBusy ? "내레이션 생성 중…" : "내레이션 만들기 (TTS)"}
        </button>
      </div>
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

/* ───────── 작은 헬퍼들 ───────── */

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="space-y-1.5">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="inp">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function EngineBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center rounded-md border px-2 py-1.5 text-[11px] font-semibold transition ${
        active
          ? "border-indigo-500 bg-indigo-600 text-white"
          : "border-[#1d2845] bg-[#0a101f] text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function ActionBtn({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5 rounded-lg border border-[#1b2440] bg-[#0a101f] py-2 text-[11px] font-semibold text-slate-300 transition hover:border-indigo-500/60 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      {children}
    </button>
  );
}
