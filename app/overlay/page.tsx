"use client";

import { useEffect, useRef } from "react";

import { MediaController } from "@/lib/editor/media";
import { drawFrame } from "@/lib/editor/render";
import { buildOverlayProject } from "@/lib/editor/seed-project";

/**
 * 자동 합성용 오버레이 렌더 하버스트.
 * `/overlay?title=...` 로 열면 해숏티 템플릿을 투명 배경으로 렌더해
 * window.__overlay (PNG dataURL) 에 담는다. (compose-short 스크립트가 읽음)
 */
export default function OverlayPage() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const title = params.get("title") ?? "";
      const footerY = Number(params.get("footerY"));
      const headerY = Number(params.get("headerY"));
      const project = buildOverlayProject(
        title,
        5,
        Number.isFinite(footerY) && footerY > 0 && footerY < 1 ? footerY : 0.8,
        Number.isFinite(headerY) && headerY > 0 && headerY < 1 ? headerY : 0,
      );
      const canvas = ref.current;
      if (!canvas) return;
      canvas.width = project.width;
      canvas.height = project.height;
      const ctx = canvas.getContext("2d"); // 기본 alpha=true → 투명
      if (!ctx) return;

      const controller = new MediaController();
      controller.ensure(project, []);
      await controller.waitReady(8000); // 프로필 로고 등 이미지 로드 대기
      // 제목 폰트(Black Han Sans) 로드 완료까지 대기 — 폴백 폰트 렌더 방지
      try {
        await document.fonts.load('400 120px "Black Han Sans"');
        await document.fonts.ready;
      } catch {
        /* 폰트 로드 실패해도 진행 */
      }
      if (cancelled) return;

      drawFrame(ctx, project, 0, {
        renderScale: 1,
        resolver: controller.resolver(),
        transparent: true,
      });

      const w = window as unknown as { __overlay?: string; __overlayReady?: boolean };
      w.__overlay = canvas.toDataURL("image/png");
      w.__overlayReady = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <canvas ref={ref} style={{ background: "transparent" }} />;
}
