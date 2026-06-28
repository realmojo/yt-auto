"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  ASPECT_DIMS,
  DEFAULT_PPS,
  HISTORY_LIMIT,
  MIN_CLIP_DURATION,
  MIN_DURATION,
  MIN_PPS,
  MAX_PPS,
} from "./constants";
import { makeAudioClip, makeProject } from "./factory";
import { clamp, computeDuration, uid } from "./geometry";
import { templateContext, type EditorTemplate } from "./templates";
import type {
  AspectRatio,
  Clip,
  EditorState,
  MediaAsset,
  Project,
  Track,
  TrackKind,
  WatermarkConfig,
} from "./types";

/* ───────── vanilla store ───────── */

export interface EditorStore {
  getState: () => EditorState;
  subscribe: (fn: () => void) => () => void;
  actions: EditorActions;
}

function recompute(project: Project): Project {
  return { ...project, duration: computeDuration(project.clips, MIN_DURATION) };
}

export function createEditorStore(
  initial?: Project,
  initialAssets: MediaAsset[] = [],
): EditorStore {
  let state: EditorState = {
    project: recompute(initial ?? makeProject("9:16")),
    assets: initialAssets,
    currentTime: 0,
    playing: false,
    loop: false,
    snapping: true,
    selectedIds: [],
    pxPerSecond: DEFAULT_PPS,
    past: [],
    future: [],
  };

  const listeners = new Set<() => void>();
  let pending: Project | null = null; // 드래그 시작 시점 스냅샷
  let clipboard: Clip[] = []; // 복사/붙여넣기 버퍼

  const emit = () => listeners.forEach((l) => l());
  const getState = () => state;
  const set = (patch: Partial<EditorState>) => {
    state = { ...state, ...patch };
    emit();
  };

  /** 히스토리에 현재 project 푸시 후 새 project 적용 */
  const commitProject = (next: Project) => {
    const past = [...state.past, state.project].slice(-HISTORY_LIMIT);
    set({ project: recompute(next), past, future: [] });
  };

  /** 히스토리 없이 project 갱신 (드래그 중) */
  const liveProject = (next: Project) => {
    set({ project: recompute(next) });
  };

  const findClip = (id: string) =>
    state.project.clips.find((c) => c.id === id) ?? null;

  const actions: EditorActions = {
    /* 재생 / 시간 */
    setCurrentTime: (t) =>
      set({ currentTime: clamp(t, 0, state.project.duration) }),
    seek: (t) =>
      set({ currentTime: clamp(t, 0, state.project.duration) }),
    seekBy: (d) =>
      set({
        currentTime: clamp(state.currentTime + d, 0, state.project.duration),
      }),
    play: () => {
      const atEnd =
        state.currentTime >= state.project.duration - 1e-3 && !state.loop;
      set(atEnd ? { currentTime: 0, playing: true } : { playing: true });
    },
    pause: () => set({ playing: false }),
    togglePlay: () => {
      if (state.playing) {
        set({ playing: false });
        return;
      }
      const atEnd =
        state.currentTime >= state.project.duration - 1e-3 && !state.loop;
      set(atEnd ? { currentTime: 0, playing: true } : { playing: true });
    },
    setPlaying: (v) => set({ playing: v }),
    setLoop: (v) => set({ loop: v }),
    setSnapping: (v) => set({ snapping: v }),
    toggleSnap: () => set({ snapping: !state.snapping }),

    /* 타임라인 줌 */
    setPxPerSecond: (pps) =>
      set({ pxPerSecond: clamp(pps, MIN_PPS, MAX_PPS) }),

    /* 선택 */
    select: (ids) => set({ selectedIds: ids }),
    selectOne: (id) => set({ selectedIds: id ? [id] : [] }),
    toggleSelect: (id) =>
      set({
        selectedIds: state.selectedIds.includes(id)
          ? state.selectedIds.filter((s) => s !== id)
          : [...state.selectedIds, id],
      }),
    clearSelection: () => set({ selectedIds: [] }),
    selectAll: () =>
      set({ selectedIds: state.project.clips.map((c) => c.id) }),

    /* 프로젝트 메타 */
    setProjectName: (name) => commitProject({ ...state.project, name }),
    setBackground: (background) =>
      commitProject({ ...state.project, background }),
    setWatermark: (patch, history = true) => {
      const next = {
        ...state.project,
        watermark: { ...state.project.watermark, ...patch },
      };
      if (history) commitProject(next);
      else liveProject(next);
    },
    setAspect: (aspect: AspectRatio) => {
      const dims = ASPECT_DIMS[aspect];
      commitProject({
        ...state.project,
        aspect,
        width: dims.width,
        height: dims.height,
      });
    },

    /* 클립 CRUD */
    addClip: (clip) => {
      commitProject({
        ...state.project,
        clips: [...state.project.clips, clip],
      });
      set({ selectedIds: [clip.id] });
    },
    addClips: (clips) => {
      commitProject({
        ...state.project,
        clips: [...state.project.clips, ...clips],
      });
      set({ selectedIds: clips.map((c) => c.id) });
    },
    updateClip: (id, patch, history = true) => {
      const next = {
        ...state.project,
        clips: state.project.clips.map((c) =>
          c.id === id ? ({ ...c, ...patch } as Clip) : c,
        ),
      };
      if (history) commitProject(next);
      else liveProject(next);
    },
    updateSelected: (patch) => {
      const ids = new Set(state.selectedIds);
      if (ids.size === 0) return;
      commitProject({
        ...state.project,
        clips: state.project.clips.map((c) =>
          ids.has(c.id) ? ({ ...c, ...patch } as Clip) : c,
        ),
      });
    },
    removeClip: (id) => {
      commitProject({
        ...state.project,
        clips: state.project.clips.filter((c) => c.id !== id),
      });
      set({ selectedIds: state.selectedIds.filter((s) => s !== id) });
    },
    removeSelected: () => {
      const ids = new Set(state.selectedIds);
      if (ids.size === 0) return;
      // 잠금/숨김 트랙의 클립은 보호 (마우스 편집과 동일한 불변식)
      const blocked = new Set(
        state.project.tracks.filter((t) => t.locked || t.hidden).map((t) => t.id),
      );
      const removable = new Set(
        state.project.clips
          .filter((c) => ids.has(c.id) && !blocked.has(c.trackId))
          .map((c) => c.id),
      );
      if (removable.size === 0) return;
      commitProject({
        ...state.project,
        clips: state.project.clips.filter((c) => !removable.has(c.id)),
      });
      set({ selectedIds: state.selectedIds.filter((id) => !removable.has(id)) });
    },
    duplicateSelected: () => {
      const ids = new Set(state.selectedIds);
      const dupes: Clip[] = [];
      for (const c of state.project.clips) {
        if (!ids.has(c.id)) continue;
        dupes.push({
          ...c,
          id: uid("clp"),
          name: `${c.name} 복사`,
          start: c.start + 0.3,
        } as Clip);
      }
      if (dupes.length === 0) return;
      commitProject({
        ...state.project,
        clips: [...state.project.clips, ...dupes],
      });
      set({ selectedIds: dupes.map((d) => d.id) });
    },
    splitAt: (clipId, time) => {
      const clip = findClip(clipId);
      if (!clip) return;
      const localStart = clip.start;
      const end = clip.start + clip.duration;
      if (time <= localStart + MIN_CLIP_DURATION) return;
      if (time >= end - MIN_CLIP_DURATION) return;
      const leftDur = time - localStart;
      const left = { ...clip, duration: leftDur } as Clip;
      const right = {
        ...clip,
        id: uid("clp"),
        start: time,
        duration: end - time,
      } as Clip;
      if (
        (right.type === "video" || right.type === "audio") &&
        (clip.type === "video" || clip.type === "audio")
      ) {
        (right as { trimStart: number }).trimStart =
          clip.trimStart + leftDur;
      }
      commitProject({
        ...state.project,
        clips: state.project.clips.flatMap((c) =>
          c.id === clipId ? [left, right] : [c],
        ),
      });
      set({ selectedIds: [right.id] });
    },

    /* ─── 컷편집 ─── */

    /** 재생헤드 위치에서 자르기. 선택 클립이 걸쳐 있으면 그것만, 없으면 편집가능 트랙의 모든 해당 클립 */
    splitAtPlayhead: () => {
      const t = state.currentTime;
      const blocked = new Set(
        state.project.tracks
          .filter((tk) => tk.locked || tk.hidden)
          .map((tk) => tk.id),
      );
      const crosses = (c: Clip) =>
        !blocked.has(c.trackId) &&
        t > c.start + MIN_CLIP_DURATION &&
        t < c.start + c.duration - MIN_CLIP_DURATION;
      const sel = new Set(state.selectedIds);
      let targets = state.project.clips.filter((c) => sel.has(c.id) && crosses(c));
      if (targets.length === 0) targets = state.project.clips.filter(crosses);
      if (targets.length === 0) return;
      const targetIds = new Set(targets.map((c) => c.id));
      const newSel: string[] = [];
      const clips = state.project.clips.flatMap((c) => {
        if (!targetIds.has(c.id)) return [c];
        const leftDur = t - c.start;
        const left = { ...c, duration: leftDur } as Clip;
        const right = {
          ...c,
          id: uid("clp"),
          start: t,
          duration: c.start + c.duration - t,
        } as Clip;
        if (c.type === "video" || c.type === "audio") {
          (right as { trimStart: number }).trimStart = c.trimStart + leftDur;
        }
        newSel.push(right.id);
        return [left, right];
      });
      commitProject({ ...state.project, clips });
      set({ selectedIds: newSel });
    },

    /** 리플 삭제: 선택 클립을 지우고 같은 트랙의 뒤 클립을 당겨 갭을 닫는다 */
    rippleDeleteSelected: () => {
      const ids = new Set(state.selectedIds);
      if (ids.size === 0) return;
      const blocked = new Set(
        state.project.tracks
          .filter((t) => t.locked || t.hidden)
          .map((t) => t.id),
      );
      const deleted = state.project.clips.filter(
        (c) => ids.has(c.id) && !blocked.has(c.trackId),
      );
      if (deleted.length === 0) return;
      const delSet = new Set(deleted.map((c) => c.id));
      const byTrack = new Map<string, Clip[]>();
      for (const d of deleted) {
        const arr = byTrack.get(d.trackId) ?? [];
        arr.push(d);
        byTrack.set(d.trackId, arr);
      }
      const shifted = state.project.clips
        .filter((c) => !delSet.has(c.id))
        .map((c) => {
          const dels = byTrack.get(c.trackId);
          if (!dels) return c;
          let shift = 0;
          for (const d of dels) if (d.start < c.start) shift += d.duration;
          return shift > 0 ? ({ ...c, start: Math.max(0, c.start - shift) } as Clip) : c;
        });
      commitProject({ ...state.project, clips: shifted });
      set({ selectedIds: [] });
    },

    /** 선택 클립을 클립보드에 복사 */
    copySelected: () => {
      const ids = new Set(state.selectedIds);
      const sel = state.project.clips.filter((c) => ids.has(c.id));
      if (sel.length > 0) clipboard = sel.map((c) => ({ ...c }));
    },
    /** 잘라내기: 복사 후 삭제(갭 유지) */
    cutSelected: () => {
      actions.copySelected();
      actions.removeSelected();
    },
    /** 재생헤드 위치에 클립보드 붙여넣기 (상대 간격·트랙 유지) */
    paste: () => {
      if (clipboard.length === 0) return;
      const at = state.currentTime;
      const earliest = Math.min(...clipboard.map((c) => c.start));
      const trackIds = new Set(state.project.tracks.map((t) => t.id));
      const firstVisual =
        state.project.tracks.find((t) => t.kind !== "audio")?.id ??
        state.project.tracks[0].id;
      const firstAudio =
        state.project.tracks.find((t) => t.kind === "audio")?.id ??
        state.project.tracks[state.project.tracks.length - 1].id;
      const pasted = clipboard.map(
        (c) =>
          ({
            ...c,
            id: uid("clp"),
            trackId: trackIds.has(c.trackId)
              ? c.trackId
              : c.type === "audio"
                ? firstAudio
                : firstVisual,
            start: at + (c.start - earliest),
          }) as Clip,
      );
      commitProject({
        ...state.project,
        clips: [...state.project.clips, ...pasted],
      });
      set({ selectedIds: pasted.map((p) => p.id) });
    },

    /** 인접한 컷 경계(클립 시작/끝)로 재생헤드 이동 */
    seekToAdjacentEdge: (dir) => {
      const t = state.currentTime;
      const eps = 1e-3;
      const edges = new Set<number>([0, state.project.duration]);
      for (const c of state.project.clips) {
        edges.add(c.start);
        edges.add(c.start + c.duration);
      }
      const arr = [...edges]
        .filter((e) => e >= 0 && e <= state.project.duration)
        .sort((a, b) => a - b);
      if (dir > 0) {
        const next = arr.find((e) => e > t + eps);
        if (next != null) set({ currentTime: next });
      } else {
        const prevs = arr.filter((e) => e < t - eps);
        if (prevs.length) set({ currentTime: prevs[prevs.length - 1] });
      }
    },

    /* 드래그 트랜잭션 */
    beginInteraction: () => {
      pending = state.project;
    },
    endInteraction: () => {
      if (pending && pending !== state.project) {
        const past = [...state.past, pending].slice(-HISTORY_LIMIT);
        set({ past, future: [] });
      }
      pending = null;
    },

    /* 트랙 */
    addTrack: (kind: TrackKind) => {
      const track: Track = {
        id: uid("trk"),
        kind,
        name:
          kind === "audio"
            ? "오디오"
            : kind === "text"
              ? "자막"
              : kind === "video"
                ? "비디오"
                : "오버레이",
        hidden: false,
        locked: false,
        muted: false,
      };
      commitProject({
        ...state.project,
        tracks: [...state.project.tracks, track],
      });
    },
    updateTrack: (id, patch) =>
      commitProject({
        ...state.project,
        tracks: state.project.tracks.map((t) =>
          t.id === id ? { ...t, ...patch } : t,
        ),
      }),
    removeTrack: (id) => {
      if (state.project.tracks.length <= 1) return;
      commitProject({
        ...state.project,
        tracks: state.project.tracks.filter((t) => t.id !== id),
        clips: state.project.clips.filter((c) => c.trackId !== id),
      });
    },

    /* 에셋 */
    addAsset: (asset) => set({ assets: [...state.assets, asset] }),
    removeAsset: (id) =>
      set({ assets: state.assets.filter((a) => a.id !== id) }),

    /* TTS 내레이션 오디오를 오디오 트랙에 클립으로 추가 */
    addNarration: (asset, atTime) => {
      const audio =
        state.project.tracks.find((t) => t.kind === "audio") ??
        state.project.tracks[state.project.tracks.length - 1];
      const clip = makeAudioClip(audio.id, asset, {
        start: atTime ?? state.currentTime,
      });
      commitProject({
        ...state.project,
        clips: [...state.project.clips, clip],
      });
      set({ assets: [...state.assets, asset], selectedIds: [clip.id] });
    },

    /* 템플릿 */
    applyTemplate: (tpl: EditorTemplate) => {
      const ctx = templateContext(state.project);
      const built = tpl.build(ctx);
      const builtTrackIds = new Set(built.map((c) => c.trackId));
      // 템플릿이 채우는 트랙(텍스트/오버레이)의 기존 클립을 교체, 미디어/오디오는 보존
      const kept = state.project.clips.filter(
        (c) => !builtTrackIds.has(c.trackId),
      );
      commitProject({
        ...state.project,
        background: tpl.background,
        clips: [...kept, ...built],
      });
      set({ selectedIds: [] });
    },

    /* 자막 일괄 추가 (대본 → 자막) */
    importSubtitles: (lines, perLine = 2.5) => {
      const text = state.project.tracks.find((t) => t.kind === "text");
      if (!text) return;
      const W = state.project.width;
      const H = state.project.height;
      let t = 0;
      const clips: Clip[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        clips.push({
          id: uid("clp"),
          type: "text",
          trackId: text.id,
          start: t,
          duration: perLine,
          name: line.slice(0, 16),
          x: Math.round(W * 0.08),
          y: Math.round(H * 0.72),
          width: Math.round(W * 0.84),
          height: Math.round(H * 0.12),
          rotation: 0,
          opacity: 1,
          text: line.trim(),
          color: "#ffffff",
          fontFamily: '"Noto Sans KR", sans-serif',
          fontSize: Math.round(W * 0.04),
          fontWeight: 600,
          italic: false,
          align: "center",
          vAlign: "middle",
          lineHeight: 1.3,
          letterSpacing: 0,
          background: "rgba(8,12,24,0.72)",
          stroke: null,
          shadow: true,
        });
        t += perLine;
      }
      if (clips.length === 0) return;
      commitProject({
        ...state.project,
        clips: [...state.project.clips, ...clips],
      });
    },

    /* 음성 인식(STT) 결과 → 타이밍 맞춘 자막 클립 일괄 추가 */
    importTimedSubtitles: (segments) => {
      const text = state.project.tracks.find((t) => t.kind === "text");
      if (!text || segments.length === 0) return;
      const W = state.project.width;
      const H = state.project.height;
      const clips: Clip[] = [];
      for (const seg of segments) {
        const body = seg.text.trim();
        if (!body) continue;
        const start = Math.max(0, seg.start);
        const duration = Math.max(MIN_CLIP_DURATION, seg.end - seg.start);
        clips.push({
          id: uid("clp"),
          type: "text",
          trackId: text.id,
          start,
          duration,
          name: body.slice(0, 16),
          x: Math.round(W * 0.08),
          y: Math.round(H * 0.72),
          width: Math.round(W * 0.84),
          height: Math.round(H * 0.12),
          rotation: 0,
          opacity: 1,
          text: body,
          color: "#ffffff",
          fontFamily: '"Noto Sans KR", sans-serif',
          fontSize: Math.round(W * 0.04),
          fontWeight: 600,
          italic: false,
          align: "center",
          vAlign: "middle",
          lineHeight: 1.3,
          letterSpacing: 0,
          background: "rgba(8,12,24,0.72)",
          stroke: null,
          shadow: true,
        });
      }
      if (clips.length === 0) return;
      commitProject({
        ...state.project,
        clips: [...state.project.clips, ...clips],
      });
      set({ selectedIds: clips.map((c) => c.id) });
    },

    /* 히스토리 */
    undo: () => {
      if (state.past.length === 0) return;
      const prev = state.past[state.past.length - 1];
      set({
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future].slice(0, HISTORY_LIMIT),
        project: prev,
        selectedIds: state.selectedIds.filter((id) =>
          prev.clips.some((c) => c.id === id),
        ),
        currentTime: clamp(state.currentTime, 0, prev.duration),
      });
    },
    redo: () => {
      if (state.future.length === 0) return;
      const next = state.future[0];
      set({
        future: state.future.slice(1),
        past: [...state.past, state.project].slice(-HISTORY_LIMIT),
        project: next,
      });
    },

    loadProject: (p) =>
      set({
        project: recompute(p),
        past: [],
        future: [],
        selectedIds: [],
        currentTime: 0,
      }),
    newProject: (aspect) =>
      set({
        project: makeProject(aspect),
        past: [],
        future: [],
        selectedIds: [],
        currentTime: 0,
        playing: false,
      }),
  };

  return {
    getState,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    actions,
  };
}

/* ───────── actions 타입 ───────── */

export interface EditorActions {
  setCurrentTime: (t: number) => void;
  seek: (t: number) => void;
  seekBy: (d: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setPlaying: (v: boolean) => void;
  setLoop: (v: boolean) => void;
  setSnapping: (v: boolean) => void;
  toggleSnap: () => void;
  setPxPerSecond: (pps: number) => void;
  select: (ids: string[]) => void;
  selectOne: (id: string | null) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setProjectName: (name: string) => void;
  setBackground: (bg: string) => void;
  setWatermark: (patch: Partial<WatermarkConfig>, history?: boolean) => void;
  setAspect: (aspect: AspectRatio) => void;
  addClip: (clip: Clip) => void;
  addClips: (clips: Clip[]) => void;
  updateClip: (id: string, patch: Partial<Clip>, history?: boolean) => void;
  updateSelected: (patch: Partial<Clip>) => void;
  removeClip: (id: string) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  splitAt: (clipId: string, time: number) => void;
  splitAtPlayhead: () => void;
  rippleDeleteSelected: () => void;
  copySelected: () => void;
  cutSelected: () => void;
  paste: () => void;
  seekToAdjacentEdge: (dir: number) => void;
  beginInteraction: () => void;
  endInteraction: () => void;
  addTrack: (kind: TrackKind) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  removeTrack: (id: string) => void;
  addAsset: (asset: MediaAsset) => void;
  removeAsset: (id: string) => void;
  addNarration: (asset: MediaAsset, atTime?: number) => void;
  applyTemplate: (tpl: EditorTemplate) => void;
  importSubtitles: (lines: string[], perLine?: number) => void;
  importTimedSubtitles: (
    segments: { start: number; end: number; text: string }[],
  ) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (p: Project) => void;
  newProject: (aspect: AspectRatio) => void;
}

/* ───────── React 바인딩 ───────── */

const StoreContext = createContext<EditorStore | null>(null);

export function EditorProvider({
  children,
  initial,
  initialAssets,
}: {
  children: ReactNode;
  initial?: Project;
  initialAssets?: MediaAsset[];
}) {
  const [store] = useState(() => createEditorStore(initial, initialAssets));
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}

function useStore(): EditorStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error("EditorProvider 안에서만 사용할 수 있습니다.");
  return s;
}

/** 선택자 기반 구독 — 선택 결과가 동일하면 리렌더 안 함 */
export function useEditor<T>(
  selector: (s: EditorState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useStore();
  const lastRef = useRef<{ value: T } | null>(null);
  const getSnapshot = () => {
    const next = selector(store.getState());
    if (lastRef.current && isEqual(lastRef.current.value, next)) {
      return lastRef.current.value;
    }
    lastRef.current = { value: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function useActions(): EditorActions {
  return useStore().actions;
}

/** 매 프레임 최신 state 가 필요할 때(rAF 루프 등) — 리렌더 유발 안 함 */
export function useStoreRef(): EditorStore {
  return useStore();
}

/** 얕은 배열 비교 */
export function shallowArray<T>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
