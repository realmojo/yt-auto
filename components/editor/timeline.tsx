"use client";

import {
  Copy,
  Eye,
  EyeOff,
  FoldHorizontal,
  Keyboard,
  Lock,
  Magnet,
  Plus,
  Scaling,
  Scissors,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MIN_CLIP_DURATION, SNAP_PX, TRACK_KIND_LABEL } from "@/lib/editor/constants";
import { clamp, fmtTime, snapTime } from "@/lib/editor/geometry";
import {
  shallowArray,
  useActions,
  useEditor,
  useStoreRef,
} from "@/lib/editor/store";
import { useWaveform, type Waveform } from "@/lib/editor/waveform";
import type { Clip, MediaAsset, Track } from "@/lib/editor/types";

const TRACK_H = 54;
const SUBLANE_H = 30; // 겹치는 클립이 쌓일 때 한 줄(서브레인) 높이
const LABEL_W = 134;
const RULER_H = 26;

const CLIP_COLOR: Record<Clip["type"], string> = {
  text: "border-indigo-400/60 bg-indigo-500/25 text-indigo-100",
  image: "border-emerald-400/60 bg-emerald-500/25 text-emerald-100",
  video: "border-sky-400/60 bg-sky-500/25 text-sky-100",
  audio: "border-amber-400/60 bg-amber-500/25 text-amber-100",
  shape: "border-fuchsia-400/60 bg-fuchsia-500/25 text-fuchsia-100",
};

/**
 * 한 트랙의 클립들을 겹침 없는 줄(서브레인)로 배치한다.
 * 시간상 겹치지 않는 클립은 같은 줄(가로 나란히), 겹치면 새 줄로 쌓는다.
 */
function computeLanes(trackClips: Clip[]): {
  lanes: Map<string, number>;
  count: number;
} {
  const sorted = [...trackClips].sort(
    (a, b) => a.start - b.start || a.duration - b.duration,
  );
  const laneEnds: number[] = []; // 줄별 마지막 클립의 끝 시각
  const lanes = new Map<string, number>();
  const EPS = 1e-4;
  for (const c of sorted) {
    let placed = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (c.start >= laneEnds[i] - EPS) {
        placed = i;
        break;
      }
    }
    if (placed === -1) {
      placed = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[placed] = c.start + c.duration;
    lanes.set(c.id, placed);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}

export function Timeline({
  onNaturalHeight,
}: {
  /** 트랙 콘텐츠의 자연 높이(룰러+모든 트랙 행)를 상위에 보고 → 타임라인 자동 높이 맞춤 */
  onNaturalHeight?: (h: number) => void;
}) {
  const store = useStoreRef();
  const actions = useActions();
  const tracks = useEditor((s) => s.project.tracks);
  const clips = useEditor((s) => s.project.clips);
  const assets = useEditor((s) => s.assets);
  const duration = useEditor((s) => s.project.duration);
  const pps = useEditor((s) => s.pxPerSecond);
  const snapping = useEditor((s) => s.snapping);
  const selectedIds = useEditor((s) => s.selectedIds, shallowArray);
  const hasSel = selectedIds.length > 0;
  const [showHelp, setShowHelp] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const contentRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const contentW = Math.max(duration * pps + 240, 600);
  // 표시 순서: 앞(위 트랙)이 위로 → 배열 역순
  const orderedTracks = [...tracks].reverse();

  // 룰러 + 모든 트랙 행의 자연 높이 → 상위(EditorWorkspace)가 타임라인을 자동으로 맞춘다
  const naturalContentH =
    RULER_H +
    orderedTracks.reduce((sum, track) => {
      const { count } = computeLanes(clips.filter((c) => c.trackId === track.id));
      return sum + Math.max(TRACK_H, 8 + count * SUBLANE_H);
    }, 0);
  useEffect(() => {
    onNaturalHeight?.(naturalContentH);
  }, [naturalContentH, onNaturalHeight]);

  const tickStep = pps >= 130 ? 0.5 : pps >= 65 ? 1 : pps >= 32 ? 2 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + tickStep; t += tickStep) ticks.push(t);

  const snapCandidates = (excludeId: string): number[] => {
    const cands = [0, duration, store.getState().currentTime];
    for (const c of clips) {
      if (c.id === excludeId) continue;
      cands.push(c.start, c.start + c.duration);
    }
    return cands;
  };

  const scrub = (clientX: number) => {
    const lane = laneRefs.current.values().next().value;
    const ref = scrollRef.current;
    if (!ref) return;
    const rect = ref.getBoundingClientRect();
    const x = clientX - rect.left - LABEL_W + ref.scrollLeft;
    void lane;
    actions.seek(clamp(x / pps, 0, duration));
  };

  const onRulerDown = (e: React.PointerEvent) => {
    scrub(e.clientX);
    const move = (ev: PointerEvent) => scrub(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** 클립 더블클릭 → 타임라인 끝까지 길이 연장 (비디오/오디오는 원본 소스 길이까지만) */
  const extendToEnd = (clip: Clip) => {
    const st = store.getState();
    let targetEnd = st.project.duration;
    if (clip.type === "video" || clip.type === "audio") {
      const asset = st.assets.find((a) => a.id === clip.assetId);
      if (asset && asset.duration > 0) {
        targetEnd = Math.min(targetEnd, clip.start + (asset.duration - clip.trimStart));
      }
    }
    const newDur = Math.max(MIN_CLIP_DURATION, targetEnd - clip.start);
    if (Math.abs(newDur - clip.duration) < 1e-3) return;
    actions.updateClip(clip.id, { duration: newDur });
  };

  /** 빈 트랙 영역에서 드래그 → 사각형(마퀴)으로 교차하는 클립 다중 선택 */
  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return; // 빈 영역에서만
    const container = contentRef.current;
    if (!container) return;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? new Set(store.getState().selectedIds) : new Set<string>();
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;

    const apply = (ev: PointerEvent) => {
      const x1 = Math.min(sx, ev.clientX);
      const x2 = Math.max(sx, ev.clientX);
      const y1 = Math.min(sy, ev.clientY);
      const y2 = Math.max(sy, ev.clientY);
      const rect = container.getBoundingClientRect();
      setMarquee({ left: x1 - rect.left, top: y1 - rect.top, width: x2 - x1, height: y2 - y1 });
      const hit = new Set(base);
      container.querySelectorAll<HTMLElement>("[data-clip-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.left <= x2 && r.right >= x1 && r.top <= y2 && r.bottom >= y1) {
          const id = el.dataset.clipId;
          if (id) hit.add(id);
        }
      });
      actions.select([...hit]);
    };

    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 4 && Math.abs(ev.clientY - sy) < 4) return;
      moved = true;
      apply(ev);
    };
    const up = () => {
      if (!moved && !additive) actions.clearSelection(); // 빈 곳 단순 클릭 → 선택 해제
      setMarquee(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /* 클립 드래그(이동/트림) */
  const startClipDrag = (
    e: React.PointerEvent,
    clip: Clip,
    mode: "move" | "trim-l" | "trim-r",
  ) => {
    e.stopPropagation();
    // Shift / ⌘ / Ctrl + 클릭 → 선택 토글(여러 클립 동시 선택). 드래그는 시작하지 않는다.
    if (mode === "move" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      actions.toggleSelect(clip.id);
      return;
    }
    actions.selectOne(clip.id);
    actions.beginInteraction();
    const startX = e.clientX;
    const orig = {
      start: clip.start,
      duration: clip.duration,
      trackId: clip.trackId,
      trimStart:
        clip.type === "video" || clip.type === "audio" ? clip.trimStart : 0,
    };
    const tol = store.getState().snapping ? SNAP_PX / pps : 0;

    const move = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startX) / pps;
      if (mode === "move") {
        let ns = Math.max(0, orig.start + dxSec);
        const cands = snapCandidates(clip.id);
        const snappedStart = snapTime(ns, cands, tol);
        const snappedEnd = snapTime(ns + orig.duration, cands, tol);
        if (snappedStart !== ns) ns = snappedStart;
        else if (snappedEnd !== ns + orig.duration)
          ns = snappedEnd - orig.duration;
        ns = Math.max(0, ns);

        // 세로 이동 → 트랙 변경
        let targetTrack = orig.trackId;
        for (const [tid, el] of laneRefs.current) {
          const r = el.getBoundingClientRect();
          if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
            targetTrack = tid;
            break;
          }
        }
        const tk = store.getState().project.tracks.find((t) => t.id === targetTrack);
        const compatible =
          tk &&
          (clip.type === "audio" ? tk.kind === "audio" : tk.kind !== "audio");
        actions.updateClip(
          clip.id,
          { start: ns, trackId: compatible ? targetTrack : orig.trackId },
          false,
        );
      } else if (mode === "trim-r") {
        const cands = snapCandidates(clip.id);
        let end = orig.start + orig.duration + dxSec;
        end = snapTime(end, cands, tol);
        const dur = Math.max(MIN_CLIP_DURATION, end - orig.start);
        actions.updateClip(clip.id, { duration: dur }, false);
      } else {
        // trim-l
        const cands = snapCandidates(clip.id);
        const origEnd = orig.start + orig.duration;
        let ns = clamp(orig.start + dxSec, 0, origEnd - MIN_CLIP_DURATION);
        ns = snapTime(ns, cands, tol);
        ns = clamp(ns, 0, origEnd - MIN_CLIP_DURATION);
        const patch: Partial<Clip> = {
          start: ns,
          duration: origEnd - ns,
        };
        if (clip.type === "video" || clip.type === "audio") {
          (patch as { trimStart: number }).trimStart = Math.max(
            0,
            orig.trimStart + (ns - orig.start),
          );
        }
        actions.updateClip(clip.id, patch, false);
      }
    };
    let done = false;
    const up = () => {
      if (done) return;
      done = true;
      actions.endInteraction();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** 전체 길이가 보이는 영역 너비에 딱 맞게 줌을 줄인다(가로 스크롤 없이 한눈에) */
  const fitToWindow = () => {
    const el = scrollRef.current;
    if (!el || duration <= 0) return;
    // contentW = duration*pps + 240(트레일링 여백) 이므로 그만큼 빼야 스크롤이 안 생긴다
    const avail = el.clientWidth - LABEL_W - 248;
    if (avail <= 0) return;
    actions.setPxPerSecond(avail / duration);
  };

  return (
    <div className="flex h-full flex-col bg-[#070b16]">
      {/* 타임라인 툴바 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#141b2e] px-3">
        <TimeReadout duration={duration} />
        <span className="mx-1 h-4 w-px bg-[#1d2845]" />
        <IconBtn title="재생헤드에서 자르기 (S / E)" onClick={() => actions.splitAtPlayhead()}>
          <Scissors className="size-3.5" />
        </IconBtn>
        <IconBtn
          title="선택 삭제 (Del)"
          onClick={() => actions.removeSelected()}
          disabled={!hasSel}
        >
          <Trash2 className="size-3.5" />
        </IconBtn>
        <IconBtn
          title="갭 닫고 삭제 · 리플 (W / Shift+Del)"
          onClick={() => actions.rippleDeleteSelected()}
          disabled={!hasSel}
        >
          <FoldHorizontal className="size-3.5" />
        </IconBtn>
        <IconBtn
          title="복제 (Ctrl/Cmd+D)"
          onClick={() => actions.duplicateSelected()}
          disabled={!hasSel}
        >
          <Copy className="size-3.5" />
        </IconBtn>
        <span className="mx-1 h-4 w-px bg-[#1d2845]" />
        <IconBtn
          title={`스냅 ${snapping ? "켜짐" : "꺼짐"}`}
          active={snapping}
          onClick={() => actions.toggleSnap()}
        >
          <Magnet className="size-3.5" />
        </IconBtn>
        <IconBtn title="트랙 추가(오버레이)" onClick={() => actions.addTrack("overlay")}>
          <Plus className="size-3.5" />
        </IconBtn>
        <div className="ml-auto flex items-center gap-1.5">
          <IconBtn title="단축키 보기" onClick={() => setShowHelp(true)}>
            <Keyboard className="size-3.5" />
          </IconBtn>
          <span className="mx-1 h-4 w-px bg-[#1d2845]" />
          <IconBtn title="전체 길이를 화면에 맞추기" onClick={fitToWindow}>
            <Scaling className="size-3.5" />
          </IconBtn>
          <IconBtn title="축소" onClick={() => actions.setPxPerSecond(pps * 0.8)}>
            <ZoomOut className="size-3.5" />
          </IconBtn>
          <span className="w-10 text-center font-mono text-[10px] text-slate-500">
            {Math.round(pps)}px/s
          </span>
          <IconBtn title="확대" onClick={() => actions.setPxPerSecond(pps * 1.25)}>
            <ZoomIn className="size-3.5" />
          </IconBtn>
        </div>
      </div>
      {showHelp && <ShortcutsModal onClose={() => setShowHelp(false)} />}

      {/* 트랙/룰러 스크롤 영역 */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div ref={contentRef} style={{ width: LABEL_W + contentW }} className="relative">
          {/* 룰러 */}
          <div
            className="sticky top-0 z-20 flex"
            style={{ height: RULER_H }}
          >
            <div
              className="sticky left-0 z-30 shrink-0 border-b border-r border-[#141b2e] bg-[#0a0f1c]"
              style={{ width: LABEL_W, height: RULER_H }}
            />
            <div
              className="relative shrink-0 cursor-pointer border-b border-[#141b2e] bg-[#0a0f1c]"
              style={{ width: contentW, height: RULER_H }}
              onPointerDown={onRulerDown}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full border-l border-[#1a2238]"
                  style={{ left: t * pps }}
                >
                  <span className="absolute left-1 top-0.5 font-mono text-[9px] text-slate-500">
                    {fmtTime(t, false)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 트랙 행들 — 겹치는 클립은 트랙 안에서 여러 줄(서브레인)로 쌓는다 */}
          {orderedTracks.map((track) => {
            const trackClips = clips.filter((c) => c.trackId === track.id);
            const { lanes, count } = computeLanes(trackClips);
            const rowH = Math.max(TRACK_H, 8 + count * SUBLANE_H);
            const laneH = (rowH - 8) / count;
            return (
              <div className="flex" key={track.id} style={{ height: rowH }}>
                <TrackLabel track={track} height={rowH} />
                <div
                  ref={(el) => {
                    if (el) laneRefs.current.set(track.id, el);
                    else laneRefs.current.delete(track.id);
                  }}
                  className="relative shrink-0 border-b border-[#0f1626]"
                  style={{ width: contentW, height: rowH }}
                  onPointerDown={startMarquee}
                >
                  {trackClips.map((clip) => {
                    const lane = lanes.get(clip.id) ?? 0;
                    return (
                      <ClipBlock
                        key={clip.id}
                        clip={clip}
                        pps={pps}
                        top={4 + lane * laneH}
                        height={laneH - (count > 1 ? 4 : 0)}
                        selected={selectedIds.includes(clip.id)}
                        asset={
                          clip.type === "video" || clip.type === "audio"
                            ? assets.find((a) => a.id === clip.assetId)
                            : undefined
                        }
                        onDown={startClipDrag}
                        onExtend={extendToEnd}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* 플레이헤드 (currentTime 만 별도 구독 → 매 프레임 전체 타임라인 리렌더 방지) */}
          <Playhead pps={pps} />

          {/* 드래그 선택 사각형(마퀴) */}
          {marquee && (
            <div
              className="pointer-events-none absolute z-40 rounded-sm border border-indigo-400/80 bg-indigo-400/15"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.width,
                height: marquee.height,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** currentTime 만 구독하는 가벼운 리프 — 재생 중 부모 타임라인 리렌더를 피한다 */
function TimeReadout({ duration }: { duration: number }) {
  const currentTime = useEditor((s) => s.currentTime);
  return (
    <span className="font-mono text-[11px] text-slate-400">
      {fmtTime(currentTime)} / {fmtTime(duration)}
    </span>
  );
}

function Playhead({ pps }: { pps: number }) {
  const currentTime = useEditor((s) => s.currentTime);
  return (
    <div
      className="pointer-events-none absolute top-0 z-20 w-px bg-rose-500"
      style={{ left: LABEL_W + currentTime * pps, top: 0, bottom: 0 }}
    >
      <div className="absolute -left-[5px] -top-0 size-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-rose-500" />
    </div>
  );
}

function ClipBlock({
  clip,
  pps,
  top,
  height,
  selected,
  asset,
  onDown,
  onExtend,
}: {
  clip: Clip;
  pps: number;
  top: number;
  height: number;
  selected: boolean;
  asset?: MediaAsset;
  onDown: (
    e: React.PointerEvent,
    clip: Clip,
    mode: "move" | "trim-l" | "trim-r",
  ) => void;
  onExtend: (clip: Clip) => void;
}) {
  const hasAudio = clip.type === "video" || clip.type === "audio";
  const waveform = useWaveform(hasAudio ? asset : null);
  const widthPx = Math.max(8, clip.duration * pps);
  const trimStart = hasAudio ? clip.trimStart : 0;

  return (
    <div
      data-clip-id={clip.id}
      title="더블클릭하면 끝까지 길이를 늘립니다"
      className={`group absolute flex items-center overflow-hidden rounded-md border text-[10px] font-semibold ${CLIP_COLOR[clip.type]} ${
        selected ? "ring-2 ring-white/80" : ""
      }`}
      style={{ left: clip.start * pps, width: widthPx, top, height }}
      onPointerDown={(e) => onDown(e, clip, "move")}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onExtend(clip);
      }}
    >
      {waveform && (
        <WaveformView
          waveform={waveform}
          trimStart={trimStart}
          clipDuration={clip.duration}
          widthPx={widthPx}
          color={clip.type === "audio" ? "rgba(191,219,254,0.85)" : "rgba(186,230,253,0.7)"}
        />
      )}
      <span
        data-trim="l"
        onPointerDown={(e) => onDown(e, clip, "trim-l")}
        className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
      />
      <span
        className="pointer-events-none relative z-[1] truncate px-2.5"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.75)" }}
      >
        {clip.name}
      </span>
      <span
        data-trim="r"
        onPointerDown={(e) => onDown(e, clip, "trim-r")}
        className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/40"
      />
    </div>
  );
}

/** 클립 블록 안에 trimStart~끝 구간의 파형을 그린다 */
function WaveformView({
  waveform,
  trimStart,
  clipDuration,
  widthPx,
  color,
}: {
  waveform: Waveform;
  trimStart: number;
  clipDuration: number;
  widthPx: number;
  color: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw === 0 || ch === 0) return;
    const { peaks, duration } = waveform;
    if (duration <= 0 || peaks.length === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = color;

    const L = peaks.length;
    const w0 = trimStart;
    const span = clipDuration; // 클립이 사용하는 소스 구간 길이
    const mid = ch / 2;
    const maxBar = ch * 0.46;
    const cols = Math.max(1, Math.floor(cw));
    for (let x = 0; x < cols; x++) {
      const t = w0 + (x / cols) * span;
      let amp = 0;
      if (t >= 0 && t <= duration) {
        const idx = clamp(Math.floor((t / duration) * L), 0, L - 1);
        amp = peaks[idx];
      }
      const h = Math.max(0.5, amp * maxBar);
      ctx.fillRect(x, mid - h, 1, h * 2);
    }
  }, [waveform, trimStart, clipDuration, widthPx, color]);

  return (
    <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full" />
  );
}

function TrackLabel({ track, height }: { track: Track; height: number }) {
  const actions = useActions();
  return (
    <div
      className="sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-b border-r border-[#141b2e] bg-[#0a0f1c] px-2"
      style={{ width: LABEL_W, height }}
    >
      <div className="flex items-center justify-between">
        <span className="truncate text-[11px] font-semibold text-slate-300">
          {track.name}
        </span>
        <span className="rounded bg-[#141b2e] px-1 text-[8px] font-bold tracking-wider text-slate-500">
          {TRACK_KIND_LABEL[track.kind]}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-slate-500">
        <button
          title="숨김"
          onClick={() => actions.updateTrack(track.id, { hidden: !track.hidden })}
          className="hover:text-slate-200"
        >
          {track.hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        </button>
        <button
          title="잠금"
          onClick={() => actions.updateTrack(track.id, { locked: !track.locked })}
          className="hover:text-slate-200"
        >
          {track.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
        </button>
        <button
          title="음소거"
          onClick={() => actions.updateTrack(track.id, { muted: !track.muted })}
          className="hover:text-slate-200"
        >
          {track.muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
        </button>
        <button
          title="트랙 삭제"
          onClick={() => actions.removeTrack(track.id)}
          className="ml-auto hover:text-rose-300"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex size-7 items-center justify-center rounded-md border transition disabled:opacity-40 ${
        active
          ? "border-indigo-500 bg-indigo-600/25 text-indigo-300"
          : "border-[#1d2845] bg-[#0a101f] text-slate-400 hover:text-indigo-300"
      }`}
    >
      {children}
    </button>
  );
}

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "Space", label: "재생 / 일시정지" },
  { keys: "S / E", label: "재생헤드에서 자르기" },
  { keys: "Del", label: "선택 삭제" },
  { keys: "W / Shift+Del", label: "갭 닫고 삭제 (리플)" },
  { keys: "Ctrl/⌘+C / X / V", label: "복사 / 잘라내기 / 붙여넣기" },
  { keys: "Ctrl/⌘+D", label: "복제" },
  { keys: "Ctrl/⌘+A", label: "전체 선택" },
  { keys: "Ctrl/⌘+Z", label: "실행취소" },
  { keys: "Shift+Ctrl/⌘+Z", label: "다시실행" },
  { keys: ", / .", label: "한 프레임 뒤로 / 앞으로" },
  { keys: "[ / ]", label: "이전 / 다음 컷으로 이동" },
  { keys: "← / →", label: "(선택 없음) 프레임 이동 · (선택) 클립 미세 이동" },
  { keys: "Shift+화살표", label: "클립 크게 이동" },
  { keys: "Home / End", label: "처음 / 끝으로" },
];

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[440px] rounded-2xl border border-[#1d2845] bg-[#0a101f] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[14px] font-bold text-slate-100">
            <Keyboard className="size-4 text-indigo-400" /> 컷편집 단축키
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between gap-3 rounded-lg border border-[#161e33] bg-[#070b16] px-3 py-1.5"
            >
              <span className="text-[12px] text-slate-300">{s.label}</span>
              <kbd className="rounded bg-[#1a2238] px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
