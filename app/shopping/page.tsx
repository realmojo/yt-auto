"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Clapperboard,
  Copy,
  Download,
  FileText,
  Heart,
  Loader2,
  Music,
  Play,
  Search,
  ShoppingBag,
  Volume2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Phase = "idle" | "uploading" | "searching" | "previewing" | "running" | "done" | "error";
type Item = {
  source: "rednote" | "taobao";
  key: string;
  id: string;
  title: string;
  cover: string;
  streamUrl: string;
  videoRef: string;
  downloaded: boolean;
};
type Scene = { part?: string; narration: string; caption: string };
type Script = { title: string; scenes: Scene[]; cta: string; hashtags: string[] };
type SSEvent = {
  type: "log" | "done" | "error";
  line?: string;
  message?: string;
  source?: string;
  url?: string;
  script?: Script;
};
const VOICES = ["Yuna", "Suhyun", "Minsu", "Jian"];
const CLIP_SECS = 5;

const dlName = (v: Item) =>
  `${(v.title || v.id).replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 50) || v.id}.mp4`;

// 대본(script) → textarea 텍스트(한 줄 = 한 장면; 자막≠내레이션이면 "자막 | 내레이션")
const scriptToText = (sc: Script | null) =>
  !sc
    ? ""
    : (sc.scenes || [])
        .map((s) =>
          s.caption && s.caption !== s.narration
            ? `${s.caption} | ${s.narration}`
            : s.narration || s.caption || "",
        )
        .join("\n");

async function consumeSSE(res: Response, onEvent: (e: SSEvent) => void) {
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
      if (line) onEvent(JSON.parse(line) as SSEvent);
    }
  }
}

/** 커버 썸네일 갤러리(샤오홍수/타오바오 공통) — 다중선택(선택 순서 배지) */
function Gallery({
  title,
  icon,
  accent,
  items,
  empty,
  selectedKeys,
  onToggle,
  busy,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  items: Item[];
  empty: string;
  selectedKeys: string[];
  onToggle: (key: string) => void;
  busy: boolean;
}) {
  return (
    <section className="rounded-2xl border p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${accent}`}>{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="ml-auto text-xs text-muted-foreground">{items.length}개</span>
      </div>
      {items.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground">
          <Play className="h-6 w-6 opacity-30" />
          <span className="text-xs">{empty}</span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((v) => {
            const order = selectedKeys.indexOf(v.key);
            const active = order >= 0;
            return (
              <div
                key={v.key}
                onClick={() => onToggle(v.key)}
                title={v.title || v.id}
                className={`group relative aspect-[9/16] cursor-pointer overflow-hidden rounded-lg border-2 bg-muted transition ${
                  active
                    ? "border-yellow-400 ring-2 ring-yellow-300/50"
                    : "border-transparent hover:border-muted-foreground/40"
                } ${busy ? "pointer-events-none opacity-60" : ""}`}
              >
                {v.streamUrl ? (
                  <video
                    src={v.streamUrl}
                    poster={v.cover || undefined}
                    muted
                    loop
                    playsInline
                    preload="none"
                    className="h-full w-full object-cover"
                    onMouseEnter={(e) => {
                      e.currentTarget.play().catch(() => {});
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget;
                      el.pause();
                      el.currentTime = 0;
                    }}
                  />
                ) : v.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.cover} alt={v.title} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground">
                    {v.title || v.id}
                  </span>
                )}
                {v.streamUrl && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-70 transition group-hover:opacity-0">
                    <Play className="h-7 w-7 fill-white/80 text-white drop-shadow" />
                  </span>
                )}
                {active && (
                  <span className="absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-400 text-[11px] font-bold text-slate-900">
                    {order + 1}
                  </span>
                )}
                {v.downloaded && (
                  <span className="absolute bottom-6 left-1 z-10 rounded bg-emerald-500/90 px-1 text-[9px] font-medium text-white">
                    받음
                  </span>
                )}
                {/* 개별 다운로드 버튼(선택 클릭과 분리) */}
                {v.streamUrl && (
                  <a
                    href={v.streamUrl}
                    download={dlName(v)}
                    onClick={(e) => e.stopPropagation()}
                    title="이 영상 다운로드"
                    className="absolute right-1 top-1 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition hover:bg-black/85 group-hover:opacity-100"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 pr-2 text-[10px] text-white">
                  {v.title || v.id}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function ShoppingPage() {
  const [keyword, setKeyword] = useState("");
  const [voice, setVoice] = useState("Yuna");
  const [skipScript, setSkipScript] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<Item[]>([]);
  const [taobao, setTaobao] = useState<Item[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [script, setScript] = useState<Script | null>(null);
  const [scriptText, setScriptText] = useState(""); // 직접 입력/수정용 대본
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [cleanSubs, setCleanSubs] = useState(true); // 원본 번인 자막 자동 제거
  const [copied, setCopied] = useState(false);
  const [sampling, setSampling] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const allItems = [...videos, ...taobao];
  const selectedItems = selectedKeys
    .map((k) => allItems.find((i) => i.key === k))
    .filter((x): x is Item => !!x);
  const selectedPayload = selectedItems.map(({ source, id, videoRef }) => ({ source, id, videoRef }));
  const estSec = selectedKeys.length * CLIP_SECS;

  const busy =
    phase === "running" || phase === "uploading" || phase === "searching" || phase === "previewing";

  const pushLog = (line: string) => {
    setLogs((l) => [...l, line]);
    setStatus(line);
    requestAnimationFrame(() => logRef.current?.scrollTo({ top: 1e9 }));
  };

  const toggleSelect = (key: string) =>
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "샘플 생성 실패");
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

  const loadVideos = useCallback(async (kw: string) => {
    if (!kw.trim()) {
      setVideos([]);
      setTaobao([]);
      return;
    }
    try {
      const r = await fetch(`/api/shopping/videos?keyword=${encodeURIComponent(kw.trim())}`);
      const j = await r.json();
      setVideos(j.videos || []);
      setTaobao(j.taobao || []);
    } catch {
      setVideos([]);
      setTaobao([]);
    }
  }, []);

  const loadScript = useCallback(async (kw: string) => {
    if (!kw.trim()) {
      setScript(null);
      setScriptText("");
      return;
    }
    try {
      const r = await fetch(
        `/api/shopping/file?keyword=${encodeURIComponent(kw.trim())}&name=script.json&t=${Date.now()}`,
      );
      if (!r.ok) {
        setScript(null);
        return;
      }
      const j = await r.json();
      const sc = j && Array.isArray(j.scenes) ? j : null;
      setScript(sc);
      if (sc) setScriptText(scriptToText(sc));
    } catch {
      setScript(null);
    }
  }, []);

  // 직접 입력한 대본을 script.json 으로 저장
  async function saveScript(silent = false): Promise<Script | null> {
    const kw = keyword.trim();
    if (!kw || !scriptText.trim()) return null;
    try {
      const res = await fetch("/api/shopping/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: kw, text: scriptText }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "대본 저장 실패");
      setScript(j.script);
      if (!silent) setStatus("대본 저장됨 — 이 대본으로 자막이 만들어집니다");
      return j.script as Script;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(scriptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("클립보드 복사에 실패했습니다.");
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      loadVideos(keyword);
      loadScript(keyword);
    }, 400);
    return () => clearTimeout(t);
  }, [keyword, loadVideos, loadScript]);

  // ★ 통합 검색: 샤오홍수 7 + 타오바오 7 커버 수집(다운로드 X)
  async function search() {
    const kw = keyword.trim();
    if (!kw || busy) return;
    setLogs([]);
    setError(null);
    setVideoUrl(null);
    setScript(null);
    // 새 검색은 화면도 초기화(이전 캐시가 남아 보이지 않게)
    setVideos([]);
    setTaobao([]);
    setSelectedKeys([]);
    setPhase("searching");
    try {
      const res = await fetch("/api/shopping/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: kw, limit: 7 }),
      });
      await consumeSSE(res, (evt) => {
        if (evt.type === "log") pushLog(evt.line ?? "");
        else if (evt.type === "done") {
          setPhase("idle");
          setStatus("수집 완료 — 쓸 영상을 골라주세요");
        } else if (evt.type === "error") {
          setError(evt.message ?? "오류가 발생했습니다");
          setPhase("error");
        }
      });
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
    loadVideos(kw);
  }

  // 업로드 음성 → 서버 경로
  async function uploadAudio(): Promise<string | undefined> {
    if (!audioFile) return undefined;
    setPhase("uploading");
    pushLog(`⬆️ 음성 업로드: ${audioFile.name}`);
    const fd = new FormData();
    fd.append("keyword", keyword.trim());
    fd.append("file", audioFile);
    const up = await fetch("/api/shopping/upload", { method: "POST", body: fd });
    const uj = await up.json();
    if (!up.ok) throw new Error(uj.error || "음성 업로드 실패");
    if (uj.kind !== "audio") {
      pushLog("⚠️ 오디오로 인식되지 않아 무시합니다");
      return undefined;
    }
    pushLog("✓ 내레이션 음성 저장");
    return uj.path as string;
  }

  // ① 대본 생성 (선택분 다운로드 → 40~60초 5부 대본)
  async function preview() {
    const kw = keyword.trim();
    if (!kw || busy) return;
    if (!selectedKeys.length) return setError("먼저 위 갤러리에서 영상을 골라주세요.");
    setLogs([]);
    setStatus("");
    setError(null);
    setScript(null);
    setPhase("previewing");
    try {
      const res = await fetch("/api/shopping/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: kw, selected: selectedPayload }),
      });
      await consumeSSE(res, (evt) => {
        if (evt.type === "log") pushLog(evt.line ?? "");
        else if (evt.type === "done") {
          setScript(evt.script ?? null);
          setScriptText(scriptToText(evt.script ?? null));
          setPhase("idle");
          setStatus("대본 생성됨 — 필요하면 수정하고, 음성 녹음·업로드 후 쇼츠를 만드세요");
          loadVideos(kw);
        } else if (evt.type === "error") {
          setError(evt.message ?? "오류가 발생했습니다");
          setPhase("error");
        }
      });
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  // ② 쇼츠 생성 (선택 순서대로 5초 몽타주 + 자막 + 올린 음성)
  async function generate() {
    const kw = keyword.trim();
    if (!kw || busy) return;
    if (!selectedKeys.length) return setError("먼저 위 갤러리에서 영상을 골라주세요.");
    setLogs([]);
    setStatus("");
    setVideoUrl(null);
    setError(null);

    let audioPath: string | undefined;
    try {
      audioPath = await uploadAudio();
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      return;
    }

    // 직접 입력한 대본이 있으면 먼저 저장해 그대로 사용(자동생성 건너뜀)
    let reuseScript = skipScript || !!script;
    if (scriptText.trim()) {
      const saved = await saveScript(true);
      if (saved) reuseScript = true;
    }

    setPhase("running");
    try {
      const res = await fetch("/api/shopping/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keyword: kw,
          selected: selectedPayload,
          voice,
          skipScript: reuseScript,
          audioPath,
          cleanSubs,
        }),
      });
      await consumeSSE(res, (evt) => {
        if (evt.type === "log") pushLog(evt.line ?? "");
        else if (evt.type === "done") {
          setVideoUrl(evt.url ?? null);
          setPhase("done");
          setStatus("완성!");
          loadVideos(kw);
        } else if (evt.type === "error") {
          setError(evt.message ?? "오류가 발생했습니다");
          setPhase("error");
        }
      });
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  const durHint =
    estSec === 0
      ? ""
      : estSec < 40
        ? " · 40초 이상 되려면 8개+ 선택 권장"
        : estSec > 60
          ? " · 60초 이하 권장(12개 이하)"
          : " · 권장 길이 ✓";

  return (
    <main className="mx-auto max-w-[1600px] px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-300 text-slate-900">
          <Clapperboard className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">쇼핑 쇼츠 제작</h1>
          <p className="text-sm text-muted-foreground">
            검색 → 샤오홍수·타오바오에서 영상 선택 → 5초씩 이어붙여 후킹·문제·전환·기능·마무리 대본 쇼츠
          </p>
        </div>
      </header>

      {/* 검색바 */}
      <section className="mb-6 rounded-2xl border p-5">
        <label className="text-sm font-medium">키워드 (중국어 검색어)</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="예: 蘑菇加湿器 / 电风扇"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search();
            }}
            disabled={busy}
            className="sm:flex-1"
          />
          <Button onClick={search} disabled={busy || !keyword.trim()} size="lg" className="sm:w-56">
            {phase === "searching" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            {phase === "searching" ? "수집 중…" : "검색 (샤오홍수 + 타오바오)"}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          샤오홍수 7개 · 타오바오는 1페이지 전부 커버만 가져옵니다(영상은 “쇼츠 생성” 때 고른 것만
          다운로드). 최초 1회 로그인 필요:{" "}
          <code className="rounded bg-muted px-1">npm run rednote:login</code> ·{" "}
          <code className="rounded bg-muted px-1">node scripts/taobao-videos.mjs --login</code>
        </p>

        {status && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span className="truncate">{status}</span>
          </div>
        )}
        {error && (
          <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40">
            {error}
            {/인증|api[_ ]?key|ANTHROPIC/i.test(error) && (
              <div className="mt-1 text-xs opacity-80">
                대본 자동생성엔 .env.local 의 ANTHROPIC_API_KEY 가 필요합니다.
              </div>
            )}
          </div>
        )}
        {logs.length > 0 && (
          <div
            ref={logRef}
            className="mt-3 max-h-36 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
          >
            {logs.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {l}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 결과 갤러리 2단 */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Gallery
          title="샤오홍수 (RedNote)"
          icon={<Heart className="h-4 w-4 text-white" />}
          accent="bg-rose-500"
          items={videos}
          empty="검색하면 샤오홍수 영상이 여기 표시됩니다"
          selectedKeys={selectedKeys}
          onToggle={toggleSelect}
          busy={busy}
        />
        <Gallery
          title="타오바오 (상품 홍보영상)"
          icon={<ShoppingBag className="h-4 w-4 text-white" />}
          accent="bg-orange-500"
          items={taobao}
          empty="검색하면 타오바오 상품 영상이 여기 표시됩니다"
          selectedKeys={selectedKeys}
          onToggle={toggleSelect}
          busy={busy}
        />
      </div>

      {/* 제작: 좌 컨트롤 · 우 미리보기 */}
      <div className="grid gap-6 md:grid-cols-[1fr_minmax(320px,380px)]">
        <section className="space-y-5 rounded-2xl border p-6">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">쇼츠 제작</h2>
            <span className="ml-auto text-xs text-muted-foreground">
              선택 {selectedKeys.length}개 · 약 {estSec}초{durHint}
            </span>
          </div>

          {/* 선택 순서 미리보기 */}
          {selectedItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedItems.map((it, i) => (
                <span
                  key={it.key}
                  className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
                  title={it.title}
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-yellow-300 text-[9px] font-bold text-slate-900">
                    {i + 1}
                  </span>
                  {it.source === "taobao" ? "타오바오" : "샤오홍수"}
                  <button
                    type="button"
                    onClick={() => toggleSelect(it.key)}
                    disabled={busy}
                    className="ml-0.5 text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setSelectedKeys([])}
                disabled={busy}
                className="text-[11px] text-muted-foreground underline"
              >
                전체 해제
              </button>
            </div>
          )}

          {/* 대본 — 직접 입력/수정 (한 줄 = 한 자막) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">
                대본 <span className="text-xs text-muted-foreground">(한 줄 = 한 자막)</span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={copyScript}
                disabled={!scriptText.trim()}
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
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              disabled={busy}
              rows={7}
              placeholder={
                "직접 입력하거나 아래 '자동생성'을 누르세요. 한 줄이 한 장면(자막)입니다.\n예)\n방 안에 비가 내려요\n건조한 밤, 이거 하나면 끝\n지금 최저가로 만나보세요\n\n자막과 내레이션을 다르게 하려면:  짧은 자막 | 실제 읽을 내레이션 문장"
              }
              className="w-full resize-y rounded-lg border bg-transparent p-3 text-xs leading-relaxed"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={preview}
                disabled={busy || !selectedKeys.length}
                variant="outline"
                size="sm"
              >
                {phase === "previewing" ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="mr-1 h-3.5 w-3.5" />
                )}
                자동생성(Claude)
              </Button>
              <Button
                onClick={() => saveScript()}
                disabled={busy || !scriptText.trim()}
                variant="secondary"
                size="sm"
              >
                대본 저장
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              저장하면 이 대본이 자막이 됩니다. “자동생성”은 선택한 클립을 보고 후킹·문제·전환·기능·마무리
              구조로 채웁니다(클립 다운로드 포함). 쇼츠 생성 시 입력한 대본이 있으면 자동 저장됩니다.
            </p>
          </div>

          {/* 직접 만든 내레이션 음성 업로드 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">내레이션 음성 업로드 (선택)</label>
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
                <Music className={`h-5 w-5 ${audioFile ? "text-emerald-500" : "text-muted-foreground"}`} />
                <span className="truncate">
                  {audioFile ? audioFile.name : "mp3·wav·m4a 업로드 (미선택 시 자동 TTS)"}
                </span>
              </label>
              {audioFile && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setAudioFile(null)} disabled={busy}>
                  제거
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              ①로 대본을 만든 뒤, 그 대본을 읽어 녹음한 음성을 올리면 그대로 사용합니다(자막은 음성 길이에
              맞춰 배치).
            </p>
          </div>

          {/* 음성 미업로드 시: 기본 ElevenLabs TTS(고정 보이스). 아래 드롭다운은 macOS say 폴백용. */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                자동 TTS <span className="text-xs text-muted-foreground">(기본: ElevenLabs · 폴백 음성 ↓)</span>
              </label>
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
              기존 대본 재사용
            </label>
            <label className="flex items-center gap-2 pb-1 text-sm" title="원본 영상에 박힌 중국어 자막을 OCR+AI 인페인팅으로 제거">
              <input
                type="checkbox"
                checked={cleanSubs}
                onChange={(e) => setCleanSubs(e.target.checked)}
                disabled={busy}
              />
              원본 자막 자동 제거
            </label>
          </div>

          <div className="space-y-2">
            <Button
              onClick={generate}
              disabled={busy || !keyword.trim() || !selectedKeys.length}
              className="w-full"
              size="lg"
            >
              {busy && phase !== "previewing" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              {phase === "uploading" ? "업로드 중…" : phase === "running" ? "제작 중…" : "쇼츠 생성"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              선택한 클립을 순서대로 각 {CLIP_SECS}초씩 이어붙이고, 위 대본을 자막으로 얹습니다. 음성을
              올렸으면 그 음성으로, 아니면 자동 TTS 로 렌더합니다.
            </p>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border p-6">
          <div>
            <h2 className="mb-1 text-sm font-medium">{videoUrl ? "완성 미리보기" : "미리보기"}</h2>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {videoUrl ? "렌더 결과입니다." : "쇼츠를 생성하면 여기서 재생됩니다."}
            </p>
            <div className="mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-2xl border bg-black">
              {videoUrl ? (
                <video src={videoUrl} controls autoPlay loop className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Clapperboard className="h-8 w-8 opacity-40" />
                  <span className="px-4 text-center text-xs">
                    {selectedKeys.length ? `${selectedKeys.length}개 선택 · 약 ${estSec}초` : "영상을 선택하세요"}
                  </span>
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

          {/* 대본(자막) 미리보기 */}
          {script && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">대본 (후킹·문제·전환·기능·마무리)</h3>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {script.scenes?.length || 0}장면
                </span>
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
                      <span className="mt-0.5 shrink-0 rounded-full bg-yellow-300 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">
                        {s.part || i + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium leading-snug">{s.caption}</div>
                        <div className="mt-0.5 text-xs leading-snug text-muted-foreground">🎙 {s.narration}</div>
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
                    <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
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
