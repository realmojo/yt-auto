"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { useEditorHotkeys } from "@/hooks/use-editor-hotkeys";
import { buildSeedProject } from "@/lib/editor/seed-project";
import { EditorProvider } from "@/lib/editor/store";
import { Inspector } from "./inspector";
import { LeftPanel } from "./left-panel";
import { PreviewStage } from "./preview-stage";
import { Timeline } from "./timeline";
import { Toolbar } from "./toolbar";

/** 타임라인 높이(px) 범위 — 미리보기 영역을 최소 MIN_PREVIEW 만큼 남긴다 */
const MIN_TIMELINE = 200;
const MIN_PREVIEW = 150;
const DEFAULT_TIMELINE = 320;
/** 타임라인 상단 크롬(핸들 + 툴바)과 여백 — 콘텐츠 높이에 더해 실제 높이를 구한다 */
const TIMELINE_CHROME = 52;

export function EditorShell() {
  // 해숏티 릴스 템플릿 + 중국국기 영상 + 파일명 제목으로 미리 구성된 프로젝트
  const seed = useMemo(() => buildSeedProject(), []);
  return (
    <EditorProvider initial={seed.project} initialAssets={seed.assets}>
      <EditorWorkspace />
    </EditorProvider>
  );
}

/** Provider 내부 — 전역 단축키 활성화 + 레이아웃 */
function EditorWorkspace() {
  useEditorHotkeys();
  const [timelineH, setTimelineH] = useState(DEFAULT_TIMELINE);
  const columnRef = useRef<HTMLDivElement>(null);

  // 트랙 콘텐츠가 높아지면(예: 템플릿 적용으로 자막·오버레이가 늘면) 모든 트랙이
  // 한 화면에 보이도록 타임라인을 늘린다(미리보기 최소 높이는 보장, 줄이지는 않음).
  const fitToContent = useCallback((naturalH: number) => {
    const colH = columnRef.current?.clientHeight ?? 0;
    const maxH = colH
      ? Math.max(MIN_TIMELINE, colH - MIN_PREVIEW)
      : Number.POSITIVE_INFINITY;
    const fit = Math.min(maxH, Math.max(MIN_TIMELINE, naturalH + TIMELINE_CHROME));
    setTimelineH((prev) => Math.max(prev, fit));
  }, []);

  // 핸들을 위로 끌면 타임라인이 커지고(미리보기는 줄고), 아래로 끌면 작아진다.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = timelineH;
    const onMove = (ev: PointerEvent) => {
      const colH = columnRef.current?.clientHeight ?? 0;
      const maxH = Math.max(MIN_TIMELINE, colH - MIN_PREVIEW);
      const dy = startY - ev.clientY; // 위로 이동 → 양수 → 높이 증가
      setTimelineH(Math.min(maxH, Math.max(MIN_TIMELINE, startH + dy)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-[#04060e] text-slate-200">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <div ref={columnRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PreviewStage />
          <div className="flex shrink-0 flex-col" style={{ height: timelineH }}>
            {/* 위로 드래그해 타임라인을 넓히는 리사이즈 핸들 */}
            <div
              onPointerDown={startResize}
              onDoubleClick={() => setTimelineH(DEFAULT_TIMELINE)}
              title="드래그해서 타임라인 높이 조절 · 더블클릭으로 초기화"
              className="group flex h-2.5 shrink-0 cursor-row-resize items-center justify-center border-t border-[#141b2e] bg-[#0a0f1c] transition hover:bg-[#141b2e]"
            >
              <div className="h-[3px] w-12 rounded-full bg-[#2a3450] transition group-hover:bg-indigo-400" />
            </div>
            <div className="min-h-0 flex-1">
              <Timeline onNaturalHeight={fitToContent} />
            </div>
          </div>
        </div>
        <Inspector />
      </div>
    </div>
  );
}
