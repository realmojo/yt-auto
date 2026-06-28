"use client";

import { useEffect } from "react";

import { useStoreRef } from "@/lib/editor/store";

/** 입력 중(텍스트 편집)인지 */
function isEditable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    t.isContentEditable
  );
}

/**
 * 편집기 전역 단축키 (한 곳에서 통합 관리 — 중복 리스너/충돌 방지).
 * 매 키 입력마다 store.getState() 로 최신 상태를 읽어 stale closure 가 없다.
 */
export function useEditorHotkeys() {
  const store = useStoreRef();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const { actions } = store;
      const st = store.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;

      // ── 재생 ──
      if (e.code === "Space") {
        e.preventDefault();
        actions.togglePlay();
        return;
      }

      // ── 히스토리 ──
      if (mod && (k === "z" || k === "Z")) {
        e.preventDefault();
        if (e.shiftKey) actions.redo();
        else actions.undo();
        return;
      }
      if (mod && (k === "y" || k === "Y")) {
        e.preventDefault();
        actions.redo();
        return;
      }

      // ── 선택/클립보드 ──
      if (mod && (k === "a" || k === "A")) {
        e.preventDefault();
        actions.selectAll();
        return;
      }
      if (mod && (k === "c" || k === "C")) {
        e.preventDefault();
        actions.copySelected();
        return;
      }
      if (mod && (k === "x" || k === "X")) {
        e.preventDefault();
        actions.cutSelected();
        return;
      }
      if (mod && (k === "v" || k === "V")) {
        e.preventDefault();
        actions.paste();
        return;
      }
      if (mod && (k === "d" || k === "D")) {
        e.preventDefault();
        actions.duplicateSelected();
        return;
      }

      // 이하 단축키는 Ctrl/Cmd 조합이면 무시 (브라우저 기본 동작 보존)
      if (mod) return;

      // ── 컷 ──
      // 자르기: S 또는 E
      if (k === "s" || k === "S" || k === "e" || k === "E") {
        e.preventDefault();
        actions.splitAtPlayhead();
        return;
      }
      // 리플 삭제: W (Shift+Del 과 동일)
      if (k === "w" || k === "W") {
        e.preventDefault();
        actions.rippleDeleteSelected();
        return;
      }
      if (k === "Delete" || k === "Backspace") {
        e.preventDefault();
        if (e.shiftKey) actions.rippleDeleteSelected();
        else actions.removeSelected();
        return;
      }

      // ── 재생헤드 이동 ──
      const frame = 1 / Math.max(1, st.project.fps);
      if (k === ",") {
        e.preventDefault();
        actions.seekBy(-frame);
        return;
      }
      if (k === ".") {
        e.preventDefault();
        actions.seekBy(frame);
        return;
      }
      if (k === "[") {
        e.preventDefault();
        actions.seekToAdjacentEdge(-1);
        return;
      }
      if (k === "]") {
        e.preventDefault();
        actions.seekToAdjacentEdge(1);
        return;
      }
      if (k === "Home") {
        e.preventDefault();
        actions.seek(0);
        return;
      }
      if (k === "End") {
        e.preventDefault();
        actions.seek(st.project.duration);
        return;
      }

      // ── 방향키 ──
      if (k.startsWith("Arrow")) {
        // 선택 없음 + 좌우 → 프레임 이동
        if (st.selectedIds.length === 0) {
          if (k === "ArrowLeft") {
            e.preventDefault();
            actions.seekBy(-frame);
          } else if (k === "ArrowRight") {
            e.preventDefault();
            actions.seekBy(frame);
          }
          return;
        }
        // 선택 있음 → 클립 위치 미세 이동 (잠금/숨김 트랙 보호)
        e.preventDefault();
        const step = e.shiftKey ? 20 : 2;
        const blocked = new Set(
          st.project.tracks
            .filter((t) => t.locked || t.hidden)
            .map((t) => t.id),
        );
        const sel = st.project.clips.filter(
          (c) =>
            st.selectedIds.includes(c.id) &&
            c.type !== "audio" &&
            !blocked.has(c.trackId),
        );
        if (sel.length === 0) return;
        actions.beginInteraction();
        for (const c of sel) {
          const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0;
          const dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
          actions.updateClip(c.id, { x: c.x + dx, y: c.y + dy }, false);
        }
        actions.endInteraction();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);
}
