"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Clapperboard,
  Copy,
  Download,
  FileText,
  Film,
  Heart,
  ImageIcon,
  Loader2,
  Music,
  Play,
  Upload,
  Volume2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Phase = "idle" | "uploading" | "fetching" | "previewing" | "running" | "done" | "error";
type Status = { videos: number; hasScript: boolean; hasShort: boolean; hasImage: boolean };
type RefVideo = {
  name: string;
  path: string;
  src: string;
  title: string;
  author: string;
  likes: string;
  cover: string;
  uploaded: boolean;
};
type Scene = { narration: string; caption: string };
type Script = {
  title: string;
  scenes: Scene[];
  cta: string;
  hashtags: string[];
};
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
  const [videos, setVideos] = useState<RefVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);
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

  // 받아둔 레퍼런스 영상 목록을 불러온다(직접 선택용). 첫 영상을 기본 선택.
  const loadVideos = useCallback(async (kw: string) => {
    if (!kw.trim()) {
      setVideos([]);
      setSelectedVideo(null);
      return;
    }
    try {
      const r = await fetch(`/api/shopping/videos?keyword=${encodeURIComponent(kw.trim())}`);
      const j = await r.json();
      const list: RefVideo[] = j.videos || [];
      setVideos(list);
      setSelectedVideo((prev) =>
        prev && list.some((v) => v.path === prev) ? prev : (list[0]?.path ?? null),
      );
    } catch {
      setVideos([]);
      setSelectedVideo(null);
    }
  }, []);

  // 이미 만들어둔 대본(script.json)이 있으면 불러와 미리보기에 표시
  const loadScript = useCallback(async (kw: string) => {
    if (!kw.trim()) return setScript(null);
    try {
      const r = await fetch(
        `/api/shopping/file?keyword=${encodeURIComponent(kw.trim())}&name=script.json&t=${Date.now()}`,
      );
      if (!r.ok) return setScript(null);
      const j = await r.json();
      setScript(j && Array.isArray(j.scenes) ? j : null);
    } catch {
      setScript(null);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      checkStatus(keyword);
      loadVideos(keyword);
      loadScript(keyword);
    }, 400);
    return () => clearTimeout(t);
  }, [keyword, checkStatus, loadVideos, loadScript]);

  const busy =
    phase === "running" ||
    phase === "uploading" ||
    phase === "fetching" ||
    phase === "previewing";

  // 오른쪽 미리보기 패널에 띄울 선택 영상 소스
  const selectedVideoSrc = videos.find((v) => v.path === selectedVideo)?.src || null;

  // 직접 음성 제작용 — 전체 내레이션을 한 덩어리 텍스트로(장면 순서대로)
  const fullNarration = script ? script.scenes.map((s) => s.narration).join("\n") : "";
  async function copyNarration() {
    try {
      await navigator.clipboard.writeText(fullNarration);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("클립보드 복사에 실패했습니다.");
    }
  }

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
    loadVideos(keyword);
  }

  // 2단계: 대본·미리보기 — 선택한 영상으로 대본(자막)만 먼저 생성해 화면에 보여준다(렌더 X)
  async function preview() {
    if (!keyword.trim() || busy) return;
    if (!selectedVideo && !ref?.hasImage) {
      setError("먼저 배경으로 쓸 레퍼런스 영상을 선택하거나 가져오세요.");
      return;
    }
    setLogs([]);
    setStatus("");
    setError(null);
    setScript(null);
    setPhase("previewing");
    try {
      const res = await fetch("/api/shopping/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: keyword.trim(), videoPath: selectedVideo || undefined }),
      });
      await consumeSSE(res, (evt) => {
        if (evt.type === "log") pushLog(evt.line);
        else if (evt.type === "done") {
          setScript(evt.script);
          setPhase("idle");
          setStatus("대본 생성 완료 — 확인 후 쇼츠를 만드세요");
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

  // 3단계: 쇼츠 생성(렌더)
  async function generate() {
    if (!keyword.trim() || busy) return;
    setLogs([]);
    setStatus("");
    setVideoUrl(null);
    setError(null);

    let videoPath: string | undefined;
    let imagePath: string | undefined;
    let audioPath: string | undefined;

    const uploadOne = async (f: File, label: string) => {
      setPhase("uploading");
      pushLog(`⬆️ ${label} 업로드: ${f.name}`);
      const fd = new FormData();
      fd.append("keyword", keyword.trim());
      fd.append("file", f);
      const up = await fetch("/api/shopping/upload", { method: "POST", body: fd });
      const uj = await up.json();
      if (!up.ok) throw new Error(uj.error || `${label} 업로드 실패`);
      return uj as { kind: string; path: string };
    };

    try {
      // 직접 만든 내레이션 음성이 있으면 먼저 업로드 → TTS 건너뜀
      if (audioFile) {
        const uj = await uploadOne(audioFile, "음성");
        if (uj.kind === "audio") {
          audioPath = uj.path;
          pushLog("✓ 내레이션 저장 (TTS 건너뜀)");
        } else {
          pushLog("⚠️ 오디오로 인식되지 않아 무시합니다");
        }
      }

      // 배경 소스: 직접 올린 파일 우선, 없으면 그리드에서 고른 영상
      if (file) {
        const uj = await uploadOne(file, "레퍼런스");
        if (uj.kind === "video") videoPath = uj.path;
        else if (uj.kind === "image") imagePath = uj.path;
        pushLog(`✓ ${uj.kind === "video" ? "레퍼런스 영상" : "상품 이미지"} 저장`);
      } else if (selectedVideo) {
        videoPath = selectedVideo;
        const chosen = videos.find((v) => v.path === selectedVideo);
        pushLog(`🎬 선택한 영상 사용: ${chosen?.title || chosen?.name || selectedVideo}`);
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      return;
    }

    // 미리보기로 만든 대본이 있으면 재사용(재생성 안 함)
    const reuseScript = skipScript || !!script;

    setPhase("running");
    try {
      const res = await fetch("/api/shopping/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keyword: keyword.trim(),
          voice,
          skipScript: reuseScript,
          videoPath,
          imagePath,
          audioPath,
        }),
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

          {/* 레퍼런스 영상 직접 선택 — 받아둔 영상이 여러 개면 그리드에서 고른다 */}
          {videos.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  배경으로 쓸 영상 선택
                  <span className="ml-1 text-xs text-muted-foreground">({videos.length}개)</span>
                </label>
                {selectedVideo && (
                  <span className="text-xs text-muted-foreground">
                    선택됨: {videos.find((v) => v.path === selectedVideo)?.name}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {videos.map((v) => {
                  const active = selectedVideo === v.path;
                  return (
                    <button
                      key={v.path}
                      type="button"
                      onClick={() => setSelectedVideo(v.path)}
                      disabled={busy}
                      title={v.title || v.name}
                      className={`group relative aspect-[9/16] overflow-hidden rounded-lg border-2 bg-black transition ${
                        active
                          ? "border-yellow-400 ring-2 ring-yellow-300/50"
                          : "border-transparent hover:border-muted-foreground/40"
                      } ${busy ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <video
                        src={v.src}
                        poster={v.cover || undefined}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                        onMouseEnter={(e) => {
                          const el = e.currentTarget;
                          el.play().catch(() => {});
                        }}
                        onMouseLeave={(e) => {
                          const el = e.currentTarget;
                          el.pause();
                          el.currentTime = 0;
                        }}
                      />
                      {active && (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-400 text-slate-900">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      )}
                      {v.uploaded && (
                        <span className="absolute left-1 top-1 rounded bg-emerald-500/90 px-1 text-[9px] font-medium text-white">
                          업로드
                        </span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[10px] text-white">
                        <span className="truncate">{v.title || v.author || v.name}</span>
                        {v.likes && (
                          <span className="flex shrink-0 items-center gap-0.5 opacity-90">
                            <Heart className="h-2.5 w-2.5" />
                            {v.likes}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                마우스를 올리면 미리보기가 재생됩니다. 아래에서 파일을 직접 올리면 업로드본이 우선
                사용됩니다.
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

          {/* 직접 만든 내레이션 음성 업로드 — 올리면 자동 TTS 대신 이 음성을 사용 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">직접 만든 내레이션 음성 (선택)</label>
            <div className="flex items-center gap-2">
              <label
                className={`flex flex-1 cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm transition hover:bg-accent ${
                  busy ? "pointer-events-none opacity-60" : ""
                }`}
              >
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                  disabled={busy}
                />
                <Music
                  className={`h-5 w-5 ${audioFile ? "text-emerald-500" : "text-muted-foreground"}`}
                />
                <span className="truncate">
                  {audioFile ? audioFile.name : "mp3·wav·m4a 업로드 (미선택 시 자동 TTS)"}
                </span>
              </label>
              {audioFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAudioFile(null)}
                  disabled={busy}
                >
                  제거
                </Button>
              )}
            </div>
            {audioFile && (
              <p className="text-[11px] text-muted-foreground">
                이 음성을 그대로 사용합니다(자동 TTS·음성 선택 무시). 자막은 음성 길이에 맞춰
                자동 배치됩니다.
              </p>
            )}
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

          <div className="space-y-2">
            <Button
              onClick={preview}
              disabled={busy || !keyword.trim() || noSource}
              variant="outline"
              className="w-full"
              size="lg"
            >
              {phase === "previewing" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              {phase === "previewing" ? "대본 생성 중…" : "① 대본·자막 미리보기"}
            </Button>

            <Button
              onClick={generate}
              disabled={busy || !keyword.trim() || noSource}
              className="w-full"
              size="lg"
            >
              {busy && phase !== "previewing" ? (
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
                    : "② 쇼츠 생성"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              먼저 <b>①</b>로 선택한 영상 기반 대본(자막)을 만들어 확인한 뒤, <b>②</b>로 렌더하세요.
              직접 만든 음성을 올렸다면 그 음성으로 합쳐집니다.
            </p>
          </div>

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

        <section className="space-y-4 rounded-2xl border p-6">
          <div>
            <h2 className="mb-1 text-sm font-medium">
              {videoUrl ? "완성 미리보기" : "선택한 영상"}
            </h2>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {videoUrl
                ? "렌더 결과입니다."
                : selectedVideoSrc
                  ? "쇼츠 배경으로 사용할 영상입니다."
                  : "영상을 선택하면 여기서 재생됩니다."}
            </p>
            <div className="mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-2xl border bg-black">
              {videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  autoPlay
                  loop
                  className="h-full w-full object-contain"
                />
              ) : selectedVideoSrc ? (
                <video
                  key={selectedVideoSrc}
                  src={selectedVideoSrc}
                  controls
                  muted
                  loop
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Play className="h-8 w-8 opacity-40" />
                  <span className="text-xs">영상을 선택하세요</span>
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
          </div>

          {/* 대본(자막) 미리보기 — ①에서 생성되면 장면별로 표시 */}
          {script && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">자막 · 대본</h3>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {script.scenes?.length || 0}개 장면
                </span>
              </div>

              {/* 전체 내레이션 텍스트 — 직접 음성 만들 때 복사해서 사용 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    전체 내레이션 (음성 제작용)
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={copyNarration}
                  >
                    {copied ? (
                      <Check className="mr-1 h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="mr-1 h-3.5 w-3.5" />
                    )}
                    {copied ? "복사됨" : "복사"}
                  </Button>
                </div>
                <textarea
                  readOnly
                  value={fullNarration}
                  rows={Math.min(8, Math.max(3, script.scenes?.length || 3))}
                  className="w-full resize-y rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>

              {script.title && (
                <div className="rounded-lg bg-muted/60 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">제목</div>
                  <div className="text-sm font-semibold">{script.title}</div>
                </div>
              )}
              <ol className="space-y-2">
                {(script.scenes || []).map((s, i) => (
                  <li key={i} className="rounded-lg border px-3 py-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-yellow-300 text-[11px] font-bold text-slate-900">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium leading-snug">{s.caption}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground leading-snug">
                          🎙 {s.narration}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              {script.cta && (
                <div className="rounded-lg bg-yellow-50 px-3 py-2 text-sm dark:bg-yellow-950/30">
                  <span className="text-[11px] text-muted-foreground">CTA · </span>
                  {script.cta}
                </div>
              )}
              {script.hashtags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {script.hashtags.map((h, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      #{h}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
