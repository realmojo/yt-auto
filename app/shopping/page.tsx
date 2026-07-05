"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Download,
  Film,
  ImageIcon,
  Loader2,
  Play,
  Upload,
  Volume2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Phase = "idle" | "uploading" | "fetching" | "running" | "done" | "error";
type Status = { videos: number; hasScript: boolean; hasShort: boolean; hasImage: boolean };
const VOICES = ["Yuna", "Suhyun", "Minsu", "Jian"];

/** SSE 응답을 이벤트 콜백으로 소비 */
async function consumeSSE(res: Response, onEvent: (e: any) => void) {
  if (!res.body) throw new Error("스트림 없음");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const p of parts) {
      const line = p.replace(/^data: /, "").trim();
      if (line) onEvent(JSON.parse(line));
    }
  }
}

export default function ShoppingPage() {
  const [keyword, setKeyword] = useState("");
  const [voice, setVoice] = useState("Yuna");
  const [skipScript, setSkipScript] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState<Status | null>(null);
  const [sampling, setSampling] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 선택한 음성으로 짧은 문장을 합성해 미리 들려준다 (기존 /api/tts 재사용)
  async function playSample() {
    if (sampling) return;
    setSampling(true);
    setError(null);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "이 제품, 지금 최저가로 만나보세요!", voice }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "샘플 생성 실패");
      }
      const url = URL.createObjectURL(await res.blob());
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSampling(false);
    }
  }

  const pushLog = (line: string) => {
    setLogs((l) => [...l, line]);
    setStatus(line);
    requestAnimationFrame(() => logRef.current?.scrollTo({ top: 1e9 }));
  };

  // 키워드별 레퍼런스 현황 조회(디바운스)
  const checkStatus = useCallback(async (kw: string) => {
    if (!kw.trim()) return setRef(null);
    try {
      const r = await fetch(`/api/shopping/status?keyword=${encodeURIComponent(kw.trim())}`);
      setRef(await r.json());
    } catch {
      setRef(null);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => checkStatus(keyword), 400);
    return () => clearTimeout(t);
  }, [keyword, checkStatus]);

  const busy = phase === "running" || phase === "uploading" || phase === "fetching";

  // 1단계: 레퍼런스 영상 수집(RedNote)
  async function fetchRefs() {
    if (!keyword.trim() || busy) return;
    setLogs([]);
    setError(null);
    setVideoUrl(null);
    setPhase("fetching");
    try {
      const res = await fetch("/api/shopping/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim(), limit: 6 }),
      });
      await consumeSSE(res, (evt) => {
        if (evt.type === "log") pushLog(evt.line);
        else if (evt.type === "done") {
          setPhase("idle");
          setStatus("레퍼런스 수집 완료");
        } else if (evt.type === "error") {
          setError(evt.message);
          setPhase("error");
        }
      });
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
    checkStatus(keyword);
  }

  // 2단계: 쇼츠 생성
  async function generate() {
    if (!keyword.trim() || busy) return;
    setLogs([]);
    setStatus("");
    setVideoUrl(null);
    setError(null);

    let videoPath: string | undefined;
    let imagePath: string | undefined;

    if (file) {
      setPhase("uploading");
      pushLog(`⬆️ 업로드: ${file.name}`);
      const fd = new FormData();
      fd.append("keyword", keyword.trim());
      fd.append("file", file);
      const up = await fetch("/api/shopping/upload", { method: "POST", body: fd });
      const uj = await up.json();
      if (!up.ok) {
        setError(uj.error || "업로드 실패");
        setPhase("error");
        return;
      }
      if (uj.kind === "video") videoPath = uj.path;
      else imagePath = uj.path;
      pushLog(`✓ ${uj.kind === "video" ? "레퍼런스 영상" : "상품 이미지"} 저장`);
    }

    setPhase("running");
    try {
      const res = await fetch("/api/shopping/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim(), voice, skipScript, videoPath, imagePath }),
      });
      await consumeSSE(res, (evt) => {
        if (evt.type === "log") pushLog(evt.line);
        else if (evt.type === "done") {
          setVideoUrl(evt.url);
          setPhase("done");
          setStatus("완성!");
          checkStatus(keyword);
        } else if (evt.type === "error") {
          setError(evt.message);
          setPhase("error");
        }
      });
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  const noSource = ref !== null && ref.videos === 0 && !ref.hasImage && !file;

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-300 text-slate-900">
          <Clapperboard className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">쇼핑 쇼츠 제작</h1>
          <p className="text-sm text-muted-foreground">
            레퍼런스 영상 + 키워드 → 한국어 자막·내레이션 세로 쇼츠
          </p>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-[1fr_minmax(320px,380px)]">
        <section className="space-y-5 rounded-2xl border p-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">키워드</label>
            <Input
              placeholder="예: 电风扇 (샤오홍수 검색어)"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              disabled={busy}
            />
            {ref && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 ${
                    ref.videos > 0 || ref.hasImage
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                  }`}
                >
                  {ref.videos > 0
                    ? `레퍼런스 영상 ${ref.videos}개`
                    : ref.hasImage
                      ? "상품 이미지 있음"
                      : "레퍼런스 없음"}
                </span>
                {ref.hasScript && <span className="text-muted-foreground">· 대본 있음</span>}
                {ref.hasShort && <span className="text-muted-foreground">· 이전 결과 있음</span>}
              </div>
            )}
          </div>

          {/* 1단계 — 레퍼런스가 없을 때 안내 + 가져오기 */}
          {noSource && (
            <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 dark:bg-amber-950/30">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                이 키워드로 받아둔 영상이 없습니다. 샤오홍수에서 레퍼런스를 가져오거나, 아래에서 직접
                업로드하세요.
              </p>
              <Button
                onClick={fetchRefs}
                disabled={busy}
                size="sm"
                variant="secondary"
                className="mt-3"
              >
                {phase === "fetching" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                샤오홍수에서 레퍼런스 가져오기
              </Button>
              <p className="mt-2 text-[11px] text-muted-foreground">
                최초 1회 터미널에서 <code>npm run rednote:login</code> 필요
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">레퍼런스 영상 / 상품 이미지 (선택)</label>
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-4 text-sm transition hover:bg-accent ${
                busy ? "pointer-events-none opacity-60" : ""
              }`}
            >
              <input
                type="file"
                accept="video/*,image/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                disabled={busy}
              />
              {file ? (
                file.type.startsWith("video") ? (
                  <Film className="h-5 w-5 text-emerald-500" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-emerald-500" />
                )
              ) : (
                <Upload className="h-5 w-5 text-muted-foreground" />
              )}
              <span className="truncate">
                {file ? file.name : "파일 선택 (미선택 시 폴더의 영상 사용)"}
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">내레이션 음성</label>
              <div className="flex items-center gap-2">
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  disabled={busy}
                  className="h-9 rounded-md border bg-transparent px-3 text-sm"
                >
                  {VOICES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={playSample}
                  disabled={sampling || busy}
                  title="선택한 음성 미리듣기"
                >
                  {sampling ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Volume2 className="mr-1 h-4 w-4" />
                  )}
                  샘플
                </Button>
              </div>
            </div>
            <label className="flex items-center gap-2 pb-1 text-sm">
              <input
                type="checkbox"
                checked={skipScript}
                onChange={(e) => setSkipScript(e.target.checked)}
                disabled={busy}
              />
              기존 대본 재사용 (script.json)
            </label>
          </div>

          <Button
            onClick={generate}
            disabled={busy || !keyword.trim() || noSource}
            className="w-full"
            size="lg"
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="mr-2 h-4 w-4" />
            )}
            {phase === "uploading"
              ? "업로드 중…"
              : phase === "running"
                ? "제작 중…"
                : phase === "fetching"
                  ? "레퍼런스 수집 중…"
                  : "쇼츠 생성"}
          </Button>

          {status && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span className="truncate">{status}</span>
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
              {error}
              {/인증|api[_ ]?key|ANTHROPIC/i.test(error) && (
                <div className="mt-1 text-xs opacity-80">
                  .env.local 에 ANTHROPIC_API_KEY 를 넣거나, “기존 대본 재사용”으로 렌더만 하세요.
                </div>
              )}
            </div>
          )}

          {logs.length > 0 && (
            <div
              ref={logRef}
              className="max-h-40 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
            >
              {logs.map((l, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {l}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border p-6">
          <h2 className="mb-4 text-sm font-medium">미리보기</h2>
          <div className="mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-2xl border bg-black">
            {videoUrl ? (
              <video src={videoUrl} controls autoPlay loop className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Play className="h-8 w-8 opacity-40" />
                <span className="text-xs">완성되면 여기서 재생됩니다</span>
              </div>
            )}
          </div>
          {videoUrl && (
            <a href={videoUrl} download={`${keyword || "short"}.mp4`} className="mt-4 block">
              <Button variant="secondary" className="w-full">
                mp4 다운로드
              </Button>
            </a>
          )}
        </section>
      </div>
    </main>
  );
}
