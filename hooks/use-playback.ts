"use client";

import { useEffect, type RefObject } from "react";

import { MediaController } from "@/lib/editor/media";
import { drawFrame } from "@/lib/editor/render";
import { useStoreRef } from "@/lib/editor/store";
import type { MediaAsset, Project } from "@/lib/editor/types";

/**
 * 미리보기 캔버스에 rAF 루프로 매 프레임을 그리고,
 * 재생 중이면 currentTime 을 실시간으로 전진시키며 미디어를 동기화한다.
 * 캔버스 backing store 크기는 PreviewStage 가 관리한다(여기선 읽기만).
 */
export function usePlayback(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const store = useStoreRef();

  useEffect(() => {
    const controller = new MediaController();
    let raf = 0;
    let last: number | null = null;
    let lastProject: Project | null = null;
    let lastAssets: MediaAsset[] | null = null;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0) return;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;
      const st = store.getState();
      const renderScale = canvas.width / st.project.width;
      const drawT = Math.min(
        st.currentTime,
        Math.max(0, st.project.duration - 1e-3),
      );
      drawFrame(ctx, st.project, drawT, {
        renderScale,
        resolver: controller.resolver(),
      });
    };

    const loop = (ts: number) => {
      const st = store.getState();

      if (st.project !== lastProject || st.assets !== lastAssets) {
        controller.ensure(st.project, st.assets);
        lastProject = st.project;
        lastAssets = st.assets;
      }

      if (st.playing) {
        if (last == null) last = ts;
        const dt = (ts - last) / 1000;
        last = ts;
        let nt = st.currentTime + dt;
        const dur = st.project.duration;
        if (nt >= dur) {
          if (st.loop) {
            nt = dur > 0 ? nt % dur : 0;
          } else {
            nt = dur;
            store.actions.pause();
          }
        }
        store.actions.setCurrentTime(nt);
      } else {
        last = null;
      }

      const cur = store.getState();
      controller.sync(cur.project, cur.currentTime, cur.playing);
      draw();
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      controller.dispose();
    };
  }, [store, canvasRef]);
}
