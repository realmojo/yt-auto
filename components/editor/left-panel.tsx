"use client";

import {
  Captions,
  Check,
  Circle,
  Download,
  Film,
  Heart,
  LayoutTemplate,
  Loader2,
  Music,
  Play,
  Plus,
  Search,
  Shapes,
  ShoppingBag,
  Square,
  Type,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";

import { DEFAULT_TITLE_FONT } from "@/lib/editor/constants";
import { uid } from "@/lib/editor/geometry";
import {
  makeAudioClip,
  makeImageClip,
  makeShapeClip,
  makeTextClip,
  makeVideoClip,
} from "@/lib/editor/factory";
import { useActions, useEditor, useStoreRef } from "@/lib/editor/store";
import { TEMPLATES } from "@/lib/editor/templates";
import type { Clip, MediaAsset } from "@/lib/editor/types";
import { isVideoDecodable, transcodeToH264 } from "@/lib/editor/video-compat";

type Tab = "templates" | "media" | "elements";

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>("templates");
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-[#161e33] bg-[#070b16]">
      <div className="flex shrink-0 border-b border-[#141b2e]">
        <TabBtn active={tab === "templates"} onClick={() => setTab("templates")} icon={<LayoutTemplate className="size-3.5" />}>
          템플릿
        </TabBtn>
        <TabBtn active={tab === "media"} onClick={() => setTab("media")} icon={<Film className="size-3.5" />}>
          미디어
        </TabBtn>
        <TabBtn active={tab === "elements"} onClick={() => setTab("elements")} icon={<Shapes className="size-3.5" />}>
          요소
        </TabBtn>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "templates" && <TemplatesTab />}
        {tab === "media" && <MediaTab />}
        {tab === "elements" && <ElementsTab />}
      </div>
    </aside>
  );
}

function TemplatesTab() {
  const actions = useActions();
  const aspect = useEditor((s) => s.project.aspect);
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {TEMPLATES.map((t) => (
        <button
          key={t.id}
          onClick={() => actions.applyTemplate(t)}
          className="group overflow-hidden rounded-xl border border-[#1b2440] transition hover:border-indigo-500/60"
        >
          <div
            className="relative flex items-end p-2"
            style={{
              background: t.background,
              aspectRatio: aspect.replace(":", "/"),
            }}
          >
            <span className="rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {t.name}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function MediaTab() {
  const store = useStoreRef();
  const actions = useActions();
  const assets = useEditor((s) => s.assets);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [sttError, setSttError] = useState<string | null>(null);

  const onPick = () => inputRef.current?.click();

  /** 비디오/오디오의 음성을 whisper.cpp 로 전사해 타이밍 자막으로 추가 */
  const transcribe = async (asset: MediaAsset) => {
    setTranscribingId(asset.id);
    setSttError(null);
    try {
      const blob = await fetch(asset.url).then((r) => r.blob());
      const fd = new FormData();
      fd.append("file", blob, `${asset.name}.media`);
      fd.append("lang", "ko");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "전사에 실패했습니다.");
      if (!data.segments?.length) throw new Error("인식된 음성이 없습니다.");
      actions.importTimedSubtitles(data.segments);
    } catch (e) {
      setSttError(e instanceof Error ? e.message : "전사에 실패했습니다.");
    } finally {
      setTranscribingId(null);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setSttError(null);
    try {
      for (const file of Array.from(files)) {
        let asset = await loadAsset(file);
        // 이 브라우저에서 영상 디코드가 안 되면(HEVC·10bit 등) 자동으로 H.264 변환
        if (asset && asset.kind === "video" && !(await isVideoDecodable(asset.url))) {
          setStatusMsg("영상 변환 중… (코덱 호환)");
          try {
            const fixed = await transcodeToH264(file);
            URL.revokeObjectURL(asset.url);
            asset = await loadAsset(fixed);
          } catch (e) {
            setSttError(e instanceof Error ? e.message : "영상 변환에 실패했습니다.");
          } finally {
            setStatusMsg(null);
          }
        }
        if (asset) actions.addAsset(asset);
      }
    } finally {
      setBusy(false);
      setStatusMsg(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const addAssetToTimeline = (asset: MediaAsset) => {
    const st = store.getState();
    const { project, currentTime } = st;
    const W = project.width;
    const H = project.height;
    const at = currentTime;
    const hadVisualMedia = project.clips.some(
      (c) => c.type === "video" || c.type === "image",
    );
    let clip: Clip | null = null;
    if (asset.kind === "image") {
      const track = project.tracks.find((t) => t.kind === "video") ?? project.tracks[0];
      clip = makeImageClip(track.id, asset, W, H, { start: at });
    } else if (asset.kind === "video") {
      const track = project.tracks.find((t) => t.kind === "video") ?? project.tracks[0];
      clip = makeVideoClip(track.id, asset, W, H, { start: at });
    } else {
      const track =
        project.tracks.find((t) => t.kind === "audio") ?? project.tracks[project.tracks.length - 1];
      clip = makeAudioClip(track.id, asset, { start: at });
    }
    if (clip) actions.addClip(clip);
    // 첫 영상/이미지를 넣을 때 가운데 워터마크를 흐릿하게 자동 표시 (이후엔 인스펙터에서 제어)
    if (
      (asset.kind === "image" || asset.kind === "video") &&
      !hadVisualMedia &&
      !project.watermark.enabled
    ) {
      actions.setWatermark({ enabled: true });
    }
  };

  return (
    <div className="space-y-3">
      {/* 샤오홍수 · 타오바오 영상 검색 → 클릭하면 미디어 라이브러리에 추가 */}
      <ShoppingSearch onImport={(asset) => actions.addAsset(asset)} />

      <div className="h-px bg-[#141b2e]" />

      <button
        onClick={onPick}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#2a3a66] bg-[#0a101f] py-6 text-[12px] font-semibold text-slate-400 transition hover:border-indigo-500/60 hover:text-indigo-300 disabled:opacity-50"
      >
        <Upload className="size-4" />
        {busy ? (statusMsg ?? "불러오는 중…") : "이미지·영상·음악 업로드"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />

      {assets.length === 0 ? (
        <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-slate-600">
          업로드한 파일이 여기에 표시됩니다. 클릭하면 현재 시간 위치에 추가됩니다.
        </p>
      ) : (
        <div className="space-y-2">
          {sttError && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-300">
              {sttError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {assets.map((a) => {
              const canTranscribe = a.kind === "video" || a.kind === "audio";
              return (
                <div
                  key={a.id}
                  className="group relative overflow-hidden rounded-lg border border-[#1b2440] bg-[#0a101f]"
                >
                  <button
                    onClick={() => addAssetToTimeline(a)}
                    title={`${a.name} 추가`}
                    className="block w-full transition hover:opacity-90"
                  >
                    <div className="flex aspect-video items-center justify-center bg-[#070b16]">
                      {a.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt={a.name} className="size-full object-cover" />
                      ) : a.kind === "video" ? (
                        <Film className="size-6 text-sky-400" />
                      ) : (
                        <Music className="size-6 text-amber-400" />
                      )}
                    </div>
                    <div className="flex items-center gap-1 px-1.5 py-1">
                      <span className="truncate text-[10px] text-slate-400">{a.name}</span>
                      <Plus className="ml-auto size-3 shrink-0 text-slate-500 group-hover:text-indigo-300" />
                    </div>
                  </button>
                  {canTranscribe && (
                    <button
                      onClick={() => transcribe(a)}
                      disabled={transcribingId !== null}
                      title="음성을 인식해 자막으로 추가"
                      className="flex w-full items-center justify-center gap-1 border-t border-[#1b2440] bg-[#0b1322] py-1.5 text-[10px] font-semibold text-indigo-300 transition hover:bg-[#101a30] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Captions className="size-3 shrink-0" />
                      {transcribingId === a.id ? "자막 생성 중…" : "자막 생성"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── 샤오홍수 · 타오바오 영상 검색 ───────── */

type SearchItem = {
  source: "rednote" | "taobao";
  key: string;
  id: string;
  title: string;
  cover: string; // 프록시 커버 URL
  streamUrl: string; // 스트리밍 프록시 URL (없으면 재생/추가 불가)
  videoRef: string;
  downloaded: boolean;
};

const dlName = (v: SearchItem) =>
  `${(v.title || v.id).replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 50) || v.id}.mp4`;

/** shopping 과 동일한 검색: 샤오홍수 7 + 타오바오(1페이지) 커버 수집 → 두 갤러리로 표시.
 *  클릭하면 스트리밍 URL 로 미디어 라이브러리에 추가(다운로드 X). */
function ShoppingSearch({ onImport }: { onImport: (asset: MediaAsset) => void }) {
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [status, setStatus] = useState("");
  const [videos, setVideos] = useState<SearchItem[]>([]);
  const [taobao, setTaobao] = useState<SearchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [importedKeys, setImportedKeys] = useState<Set<string>>(new Set());

  const searching = phase === "searching";

  const loadVideos = async (kw: string) => {
    try {
      const r = await fetch(`/api/shopping/videos?keyword=${encodeURIComponent(kw)}`);
      const j = await r.json();
      setVideos(j.videos || []);
      setTaobao(j.taobao || []);
      return (j.videos?.length || 0) + (j.taobao?.length || 0);
    } catch {
      setVideos([]);
      setTaobao([]);
      return 0;
    }
  };

  // ★ 통합 검색: 샤오홍수 7 + 타오바오 커버 수집(다운로드 X) — shopping/page.tsx 와 동일
  const search = async () => {
    const kw = q.trim();
    if (!kw || searching) return;
    setPhase("searching");
    setError(null);
    setVideos([]);
    setTaobao([]);
    setImportedKeys(new Set());
    setStatus("샤오홍수 7개 · 타오바오 수집 중… (최초 1회 로그인 필요)");
    try {
      const res = await fetch("/api/shopping/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword: kw, limit: 7 }),
      });
      if (!res.body) throw new Error("검색 스트림을 열지 못했습니다.");
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
          if (!line) continue;
          const evt = JSON.parse(line);
          if (evt.type === "log" && evt.line) setStatus(evt.line);
          else if (evt.type === "error") throw new Error(evt.message || "검색 실패");
        }
      }
      // 수집 종료 → 메타 조회
      setStatus("결과 불러오는 중…");
      const total = await loadVideos(kw);
      setPhase("done");
      setStatus(total ? "수집 완료 — 쓸 영상을 클릭해 추가하세요" : "결과가 없습니다. 로그인/키워드를 확인하세요.");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      setStatus("");
    }
  };

  const importItem = async (it: SearchItem) => {
    if (!it.streamUrl || addingKey) return;
    setAddingKey(it.key);
    try {
      const asset = await loadRemoteVideoAsset(it.streamUrl, it.title || `${it.source}_${it.id}`);
      onImport(asset);
      setImportedKeys((s) => new Set(s).add(it.key));
    } finally {
      setAddingKey(null);
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="중국어 키워드로 영상 검색 (예: 电风扇)"
            disabled={searching}
            className="w-full rounded-lg border border-[#1b2440] bg-[#0a101f] py-2 pl-7 pr-2 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/60 focus:outline-none disabled:opacity-60"
          />
        </div>
        <button
          onClick={search}
          disabled={searching || !q.trim()}
          className="flex shrink-0 items-center justify-center rounded-lg bg-indigo-600 px-3 text-[11px] font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {searching ? <Loader2 className="size-3.5 animate-spin" /> : "검색"}
        </button>
      </div>

      {(searching || status) && !error && (
        <p className="flex items-center gap-1.5 px-0.5 text-[10px] leading-relaxed text-slate-500">
          {searching && <Loader2 className="size-3 shrink-0 animate-spin" />}
          <span className="truncate">{status}</span>
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-red-300">
          {error}
        </p>
      )}

      <ResultGallery
        title="샤오홍수 (RedNote)"
        icon={<Heart className="size-3 text-white" />}
        accent="bg-rose-500"
        items={videos}
        empty="검색하면 샤오홍수 영상이 표시됩니다"
        addingKey={addingKey}
        importedKeys={importedKeys}
        onImport={importItem}
        show={phase !== "idle"}
      />
      <ResultGallery
        title="타오바오 (상품 홍보영상)"
        icon={<ShoppingBag className="size-3 text-white" />}
        accent="bg-orange-500"
        items={taobao}
        empty="검색하면 타오바오 상품 영상이 표시됩니다"
        addingKey={addingKey}
        importedKeys={importedKeys}
        onImport={importItem}
        show={phase !== "idle"}
      />
    </div>
  );
}

/** 커버 썸네일 갤러리(샤오홍수/타오바오 공통) — shopping 의 Gallery 와 동일한 카드 스타일 */
function ResultGallery({
  title,
  icon,
  accent,
  items,
  empty,
  addingKey,
  importedKeys,
  onImport,
  show,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  items: SearchItem[];
  empty: string;
  addingKey: string | null;
  importedKeys: Set<string>;
  onImport: (it: SearchItem) => void;
  show: boolean;
}) {
  if (!show) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className={`flex size-5 items-center justify-center rounded ${accent}`}>{icon}</span>
        <h4 className="text-[11px] font-bold text-slate-300">{title}</h4>
        <span className="ml-auto text-[10px] text-slate-500">{items.length}개</span>
      </div>
      {items.length === 0 ? (
        <div className="flex h-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#1b2440] text-slate-600">
          <Play className="size-4 opacity-40" />
          <span className="px-2 text-center text-[10px]">{empty}</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {items.map((v) => {
            const imported = importedKeys.has(v.key);
            const adding = addingKey === v.key;
            const playable = !!v.streamUrl;
            return (
              <div
                key={v.key}
                onClick={() => playable && onImport(v)}
                title={playable ? `${v.title || v.id} — 미디어에 추가` : "재생 URL 없음"}
                className={`group relative aspect-[9/16] overflow-hidden rounded-lg border-2 bg-black transition ${
                  imported
                    ? "border-emerald-500/70"
                    : "border-transparent hover:border-indigo-500/60"
                } ${playable ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${
                  adding ? "pointer-events-none" : ""
                }`}
              >
                {playable ? (
                  <video
                    src={v.streamUrl}
                    poster={v.cover || undefined}
                    muted
                    loop
                    playsInline
                    preload="none"
                    className="size-full object-cover"
                    onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause();
                      e.currentTarget.currentTime = 0;
                    }}
                  />
                ) : v.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.cover} alt={v.title} loading="lazy" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center px-1 text-center text-[9px] text-slate-500">
                    {v.title || v.id}
                  </span>
                )}
                {playable && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-70 transition group-hover:opacity-0">
                    {adding ? (
                      <Loader2 className="size-5 animate-spin text-white drop-shadow" />
                    ) : imported ? (
                      <Check className="size-6 text-emerald-400 drop-shadow" />
                    ) : (
                      <Play className="size-6 fill-white/80 text-white drop-shadow" />
                    )}
                  </span>
                )}
                {v.downloaded && (
                  <span className="absolute bottom-6 left-1 z-10 rounded bg-emerald-500/90 px-1 text-[9px] font-medium text-white">
                    받음
                  </span>
                )}
                {playable && (
                  <a
                    href={v.streamUrl}
                    download={dlName(v)}
                    onClick={(e) => e.stopPropagation()}
                    title="이 영상 다운로드"
                    className="absolute right-1 top-1 z-20 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition hover:bg-black/85 group-hover:opacity-100"
                  >
                    <Download className="size-3" />
                  </a>
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[9px] text-white">
                  {v.title || v.id}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 원격 스트리밍 영상(프록시 URL) → MediaAsset (메타데이터만 로드, 다운로드 X) */
async function loadRemoteVideoAsset(url: string, name: string): Promise<MediaAsset> {
  const meta = await new Promise<{ d: number; w: number; h: number }>((res) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => res({ d: v.duration, w: v.videoWidth, h: v.videoHeight });
    v.onerror = () => res({ d: 0, w: 0, h: 0 });
    v.src = url;
  });
  return {
    id: uid("ast"),
    kind: "video",
    name: (name || "clip").slice(0, 40),
    url,
    duration: Number.isFinite(meta.d) ? meta.d : 0,
    width: meta.w,
    height: meta.h,
  };
}

function ElementsTab() {
  const store = useStoreRef();
  const actions = useActions();

  const addText = (preset: "title" | "subtitle" | "body") => {
    const { project, currentTime } = store.getState();
    const text = project.tracks.find((t) => t.kind === "text") ?? project.tracks[0];
    const W = project.width;
    const H = project.height;
    const patch =
      preset === "title"
        ? { text: "제목", fontSize: DEFAULT_TITLE_FONT, fontWeight: 800, y: Math.round(H * 0.16), background: null }
        : preset === "subtitle"
          ? { text: "자막을 입력하세요", fontSize: Math.round(W * 0.04), fontWeight: 600, y: Math.round(H * 0.72), background: "rgba(8,12,24,0.72)" }
          : { text: "본문 텍스트", fontSize: Math.round(W * 0.032), fontWeight: 400, y: Math.round(H * 0.45), background: null };
    actions.addClip(makeTextClip(text.id, W, H, { ...patch, start: currentTime } as never));
  };

  const addShape = (shape: "rect" | "ellipse") => {
    const { project, currentTime } = store.getState();
    const overlay = project.tracks.find((t) => t.kind === "overlay") ?? project.tracks[0];
    actions.addClip(
      makeShapeClip(overlay.id, project.width, project.height, {
        shape,
        start: currentTime,
        name: shape === "rect" ? "사각형" : "원",
      }),
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">텍스트</h4>
        <div className="space-y-2">
          <ElementBtn icon={<Type className="size-4" />} label="제목 추가" sub="큰 굵은 텍스트" onClick={() => addText("title")} />
          <ElementBtn icon={<Type className="size-3.5" />} label="자막 추가" sub="하단 배경 자막" onClick={() => addText("subtitle")} />
          <ElementBtn icon={<Type className="size-3" />} label="본문 추가" sub="일반 텍스트" onClick={() => addText("body")} />
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">도형</h4>
        <div className="space-y-2">
          <ElementBtn icon={<Square className="size-4" />} label="사각형" sub="배경 박스·강조" onClick={() => addShape("rect")} />
          <ElementBtn icon={<Circle className="size-4" />} label="원 / 타원" sub="포인트·아바타 틀" onClick={() => addShape("ellipse")} />
        </div>
      </div>
      <p className="rounded-lg border border-[#1d2845] bg-[#0a101f] p-3 text-[11px] leading-relaxed text-slate-500">
        요소는 현재 재생 위치에 추가됩니다. 추가 후 캔버스에서 드래그·크기조절하고,
        오른쪽 패널에서 세부 속성을 바꾸세요.
      </p>
    </div>
  );
}

/* ───────── helpers ───────── */

function ElementBtn({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-[#1b2440] bg-[#0a101f] p-2.5 text-left transition hover:border-indigo-500/60"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#11182b] text-indigo-300">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-slate-200">{label}</span>
        <span className="block text-[10px] text-slate-500">{sub}</span>
      </span>
      <Plus className="ml-auto size-3.5 shrink-0 text-slate-500" />
    </button>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition ${
        active
          ? "border-b-2 border-indigo-500 text-indigo-300"
          : "border-b-2 border-transparent text-slate-500 hover:text-slate-300"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/** File → MediaAsset (메타데이터 로드) */
async function loadAsset(file: File): Promise<MediaAsset | null> {
  const url = URL.createObjectURL(file);
  const kind = file.type.startsWith("image")
    ? "image"
    : file.type.startsWith("video")
      ? "video"
      : file.type.startsWith("audio")
        ? "audio"
        : null;
  if (!kind) {
    URL.revokeObjectURL(url);
    return null;
  }
  const base: MediaAsset = {
    id: uid("ast"),
    kind,
    name: file.name.replace(/\.[^.]+$/, ""),
    url,
    duration: 0,
    width: 0,
    height: 0,
  };
  try {
    if (kind === "image") {
      const dim = await new Promise<{ w: number; h: number }>((res, rej) => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = rej;
        img.src = url;
      });
      base.width = dim.w;
      base.height = dim.h;
    } else if (kind === "video") {
      const meta = await new Promise<{ d: number; w: number; h: number }>((res, rej) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => res({ d: v.duration, w: v.videoWidth, h: v.videoHeight });
        v.onerror = rej;
        v.src = url;
      });
      base.duration = Number.isFinite(meta.d) ? meta.d : 0;
      base.width = meta.w;
      base.height = meta.h;
    } else {
      const d = await new Promise<number>((res, rej) => {
        const a = document.createElement("audio");
        a.preload = "metadata";
        a.onloadedmetadata = () => res(a.duration);
        a.onerror = rej;
        a.src = url;
      });
      base.duration = Number.isFinite(d) ? d : 0;
    }
  } catch {
    /* 메타데이터 실패해도 기본값으로 진행 */
  }
  return base;
}
