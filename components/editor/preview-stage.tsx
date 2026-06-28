"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { usePlayback } from "@/hooks/use-playback";
import { applyResize, isActiveAt, type ResizeHandle } from "@/lib/editor/geometry";
import {
  shallowArray,
  useActions,
  useEditor,
} from "@/lib/editor/store";
import type { TextClip, VisualClip } from "@/lib/editor/types";

const HANDLES: { id: ResizeHandle; cursor: string; cx: number; cy: number }[] = [
  { id: "nw", cursor: "nwse-resize", cx: 0, cy: 0 },
  { id: "n", cursor: "ns-resize", cx: 0.5, cy: 0 },
  { id: "ne", cursor: "nesw-resize", cx: 1, cy: 0 },
  { id: "e", cursor: "ew-resize", cx: 1, cy: 0.5 },
  { id: "se", cursor: "nwse-resize", cx: 1, cy: 1 },
  { id: "s", cursor: "ns-resize", cx: 0.5, cy: 1 },
  { id: "sw", cursor: "nesw-resize", cx: 0, cy: 1 },
  { id: "w", cursor: "ew-resize", cx: 0, cy: 0.5 },
];

type Drag =
  | { mode: "move"; startX: number; startY: number; box: Box }
  | {
      mode: "resize";
      handle: ResizeHandle;
      startX: number;
      startY: number;
      box: Box;
    };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function PreviewStage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const dims = useEditor((s) => ({ w: s.project.width, h: s.project.height }), (a, b) => a.w === b.w && a.h === b.h);
  const clips = useEditor((s) => s.project.clips);
  const tracks = useEditor((s) => s.project.tracks);
  const selectedIds = useEditor((s) => s.selectedIds, shallowArray);
  const currentTime = useEditor((s) => s.currentTime);
  const actions = useActions();

  usePlayback(canvasRef);

  // 컨테이너 크기 측정 → fit
  const [box, setBox] = useState({ cw: 0, ch: 0 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBox({ cw: el.clientWidth, ch: el.clientHeight });
    });
    ro.observe(el);
    setBox({ cw: el.clientWidth, ch: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(() => {
    const pad = 32;
    const availW = Math.max(40, box.cw - pad);
    const availH = Math.max(40, box.ch - pad);
    const scale = Math.min(availW / dims.w, availH / dims.h);
    const dispW = Math.max(1, dims.w * scale);
    const dispH = Math.max(1, dims.h * scale);
    return { scale: scale > 0 ? scale : 0.0001, dispW, dispH };
  }, [box, dims]);

  // 캔버스 backing store 크기 동기화
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(fit.dispW * dpr);
    canvas.height = Math.round(fit.dispH * dpr);
    canvas.style.width = `${fit.dispW}px`;
    canvas.style.height = `${fit.dispH}px`;
  }, [fit]);

  const cssScale = fit.scale;

  const selectedClip = useMemo<VisualClip | null>(() => {
    if (selectedIds.length !== 1) return null;
    const c = clips.find((x) => x.id === selectedIds[0]);
    if (!c || c.type === "audio") return null;
    if (!isActiveAt(c, currentTime)) return null;
    const track = tracks.find((t) => t.id === c.trackId);
    if (track?.locked || track?.hidden) return null;
    return c;
  }, [selectedIds, clips, tracks, currentTime]);

  /* ───── 포인터 인터랙션 ───── */
  const dragRef = useRef<Drag | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const toBase = useCallback(
    (clientX: number, clientY: number) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left) / cssScale,
        y: (clientY - rect.top) / cssScale,
      };
    },
    [cssScale],
  );

  const hitTest = useCallback(
    (bx: number, by: number): VisualClip | null => {
      // 앞(위 트랙)부터 검사
      const visible = clips
        .filter((c): c is VisualClip => c.type !== "audio")
        .filter((c) => isActiveAt(c, currentTime))
        .filter((c) => {
          const t = tracks.find((tk) => tk.id === c.trackId);
          return t && !t.hidden && !t.locked;
        });
      const order = new Map(tracks.map((t, i) => [t.id, i]));
      visible.sort(
        (a, b) =>
          (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0) ||
          b.start - a.start,
      );
      for (const c of visible) {
        if (
          bx >= c.x &&
          bx <= c.x + c.width &&
          by >= c.y &&
          by <= c.y + c.height
        )
          return c;
      }
      return null;
    },
    [clips, tracks, currentTime],
  );

  const onPointerDownStage = (e: React.PointerEvent) => {
    if (editingId) return;
    if ((e.target as HTMLElement).dataset.handle) return; // 핸들이 처리
    const { x, y } = toBase(e.clientX, e.clientY);
    const hit = hitTest(x, y);
    if (!hit) {
      actions.clearSelection();
      return;
    }
    actions.selectOne(hit.id);
    actions.beginInteraction();
    dragRef.current = {
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      box: { x: hit.x, y: hit.y, width: hit.width, height: hit.height },
    };
    startWindowDrag(hit.id);
  };

  const startResize = (e: React.PointerEvent, handle: ResizeHandle) => {
    if (!selectedClip) return;
    e.stopPropagation();
    actions.beginInteraction();
    dragRef.current = {
      mode: "resize",
      handle,
      startX: e.clientX,
      startY: e.clientY,
      box: {
        x: selectedClip.x,
        y: selectedClip.y,
        width: selectedClip.width,
        height: selectedClip.height,
      },
    };
    startWindowDrag(selectedClip.id);
  };

  const startWindowDrag = (clipId: string) => {
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / cssScale;
      const dy = (ev.clientY - d.startY) / cssScale;
      if (d.mode === "move") {
        actions.updateClip(
          clipId,
          { x: Math.round(d.box.x + dx), y: Math.round(d.box.y + dy) },
          false,
        );
      } else {
        const next = applyResize(d.box, d.handle, dx, dy, {
          keepAspect: ev.shiftKey,
          min: 24,
        });
        actions.updateClip(
          clipId,
          {
            x: Math.round(next.x),
            y: Math.round(next.y),
            width: Math.round(next.width),
            height: Math.round(next.height),
          },
          false,
        );
      }
    };
    let done = false;
    const onUp = () => {
      if (done) return; // pointerup/pointercancel 중복 호출 방지
      done = true;
      dragRef.current = null;
      actions.endInteraction();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // 전역 단축키(이동/삭제/컷 등)는 useEditorHotkeys 에서 통합 처리

  const editingClip =
    editingId != null
      ? (clips.find((c) => c.id === editingId) as TextClip | undefined)
      : undefined;

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#05070e] [background-image:radial-gradient(circle,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:20px_20px]"
    >
      <div
        ref={wrapperRef}
        className="relative shadow-2xl"
        style={{ width: fit.dispW, height: fit.dispH }}
        onPointerDown={onPointerDownStage}
        onDoubleClick={(e) => {
          const { x, y } = toBase(e.clientX, e.clientY);
          const hit = hitTest(x, y);
          if (hit && hit.type === "text") setEditingId(hit.id);
        }}
      >
        <canvas ref={canvasRef} className="block rounded-[2px]" />

        {/* 선택 박스 + 핸들 */}
        {selectedClip && !editingId && (
          <SelectionBox
            clip={selectedClip}
            scale={cssScale}
            onResizeStart={startResize}
          />
        )}

        {/* 인라인 텍스트 편집 */}
        {editingClip && (
          <InlineTextEditor
            key={editingClip.id}
            clip={editingClip}
            scale={cssScale}
            onClose={() => setEditingId(null)}
          />
        )}
      </div>

      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/40 px-2 py-1 text-[10px] font-semibold text-slate-300">
        {dims.w}×{dims.h}
      </div>
    </div>
  );
}

function SelectionBox({
  clip,
  scale,
  onResizeStart,
}: {
  clip: VisualClip;
  scale: number;
  onResizeStart: (e: React.PointerEvent, h: ResizeHandle) => void;
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 border border-indigo-400"
      style={{
        left: clip.x * scale,
        top: clip.y * scale,
        width: clip.width * scale,
        height: clip.height * scale,
      }}
    >
      {HANDLES.map((h) => (
        <div
          key={h.id}
          data-handle={h.id}
          onPointerDown={(e) => onResizeStart(e, h.id)}
          className="pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-indigo-400 bg-white"
          style={{
            left: `${h.cx * 100}%`,
            top: `${h.cy * 100}%`,
            cursor: h.cursor,
          }}
        />
      ))}
    </div>
  );
}

function InlineTextEditor({
  clip,
  scale,
  onClose,
}: {
  clip: TextClip;
  scale: number;
  onClose: () => void;
}) {
  const actions = useActions();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    actions.beginInteraction();
    ref.current?.focus();
    ref.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <textarea
      ref={ref}
      defaultValue={clip.text}
      onChange={(e) => actions.updateClip(clip.id, { text: e.target.value }, false)}
      onBlur={() => {
        actions.endInteraction();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          (e.target as HTMLTextAreaElement).blur();
        }
        e.stopPropagation();
      }}
      className="absolute z-20 resize-none overflow-hidden rounded-sm border-2 border-indigo-400 bg-black/70 p-1 text-center text-white outline-none"
      style={{
        left: clip.x * scale,
        top: clip.y * scale,
        width: clip.width * scale,
        height: clip.height * scale,
        fontSize: clip.fontSize * scale,
        fontFamily: clip.fontFamily,
        fontWeight: clip.fontWeight,
        lineHeight: clip.lineHeight,
        textAlign: clip.align,
        color: clip.color,
      }}
    />
  );
}
