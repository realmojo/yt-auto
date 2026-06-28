"use client";

import {
  ArrowLeft,
  Captions,
  Download,
  FilePlus2,
  Loader2,
  Pause,
  Play,
  Redo2,
  Repeat,
  SkipBack,
  SkipForward,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import {
  downloadBlob,
  exportProject,
  isExportSupported,
} from "@/lib/editor/export";
import { fmtTime } from "@/lib/editor/geometry";
import { useActions, useEditor, useStoreRef } from "@/lib/editor/store";
import type { Project } from "@/lib/editor/types";

const SCRIPT_KEY = "yt-auto:script";

/** 제목 텍스트(없으면 프로젝트 이름)로 안전한 내보내기 파일명을 만든다 */
function exportFileName(project: Project): string {
  const titleClip = project.clips.find(
    (c) => c.type === "text" && c.name === "제목",
  );
  const raw =
    (titleClip && titleClip.type === "text" ? titleClip.text : "") ||
    project.name ||
    "video";
  const safe = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ \-]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return safe || "video";
}

export function Toolbar() {
  const store = useStoreRef();
  const actions = useActions();
  const playing = useEditor((s) => s.playing);
  const loop = useEditor((s) => s.loop);
  const currentTime = useEditor((s) => s.currentTime);
  const duration = useEditor((s) => s.project.duration);
  const name = useEditor((s) => s.project.name);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<"render" | "transcode">("render");
  const abortRef = useRef<AbortController | null>(null);
  const [showSub, setShowSub] = useState(false);

  const runExport = async () => {
    if (!isExportSupported()) {
      alert("이 브라우저는 영상 내보내기를 지원하지 않습니다. 최신 Chrome/Edge 를 권장합니다.");
      return;
    }
    actions.pause();
    actions.seek(0);
    setExporting(true);
    setStage("render");
    setProgress(0);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { blob, ext } = await exportProject(store, {
        onProgress: setProgress,
        signal: ctrl.signal,
      });
      const fileBase = exportFileName(store.getState().project);

      // mp4 로 녹화됐으면 그대로, 아니면(webm) 서버에서 mp4 변환
      let outBlob = blob;
      if (ext !== "mp4") {
        setStage("transcode");
        try {
          const res = await fetch(`/api/transcode?from=${ext}`, {
            method: "POST",
            body: blob,
            signal: ctrl.signal,
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error || `변환 실패 (${res.status})`);
          }
          outBlob = await res.blob();
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          // 변환 실패 → 원본(webm)으로 저장하고 안내
          alert(
            `MP4 변환에 실패해 원본(${ext})으로 저장합니다.\n사유: ${(err as Error).message}`,
          );
          downloadBlob(blob, `${fileBase}.${ext}`);
          return;
        }
      }
      downloadBlob(outBlob, `${fileBase}.mp4`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        alert(`내보내기 실패: ${(e as Error).message}`);
      }
    } finally {
      setExporting(false);
      abortRef.current = null;
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#141b2e] bg-[#070b16] px-4">
      <Link
        href="/"
        className="flex size-9 items-center justify-center rounded-lg border border-[#1d2845] bg-[#0a101f] text-slate-400 transition hover:text-indigo-300"
        title="대본 스튜디오로"
      >
        <ArrowLeft className="size-4" />
      </Link>
      <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 text-sm font-black text-white shadow-[0_0_18px_rgba(79,90,245,0.5)]">
        ✂
      </div>
      <div className="leading-tight">
        <h1 className="text-[14px] font-bold tracking-tight">
          영상 편집기 <span className="text-indigo-400">Editor</span>
        </h1>
        <p className="max-w-[160px] truncate text-[11px] text-slate-500">{name}</p>
      </div>

      {/* 재생 컨트롤 */}
      <div className="mx-auto flex items-center gap-1.5">
        <TBtn title="처음으로" onClick={() => actions.seek(0)}>
          <SkipBack className="size-4" />
        </TBtn>
        <button
          onClick={() => actions.togglePlay()}
          className="flex size-10 items-center justify-center rounded-full bg-indigo-600 text-white shadow-[0_0_16px_rgba(79,90,245,0.45)] transition hover:brightness-110"
          title={playing ? "일시정지 (Space)" : "재생 (Space)"}
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-0.5" />}
        </button>
        <TBtn title="끝으로" onClick={() => actions.seek(duration)}>
          <SkipForward className="size-4" />
        </TBtn>
        <TBtn title="반복" active={loop} onClick={() => actions.setLoop(!loop)}>
          <Repeat className="size-4" />
        </TBtn>
        <span className="ml-2 w-24 font-mono text-[12px] text-slate-400">
          {fmtTime(currentTime)} / {fmtTime(duration)}
        </span>
      </div>

      {/* 우측 액션 */}
      <div className="flex items-center gap-1.5">
        <TBtn title="실행취소" onClick={() => actions.undo()} disabled={!canUndo}>
          <Undo2 className="size-4" />
        </TBtn>
        <TBtn title="다시실행" onClick={() => actions.redo()} disabled={!canRedo}>
          <Redo2 className="size-4" />
        </TBtn>
        <span className="mx-1 h-5 w-px bg-[#1d2845]" />
        <button
          onClick={() => setShowSub(true)}
          className="flex items-center gap-1.5 rounded-lg border border-[#1d2845] bg-[#0a101f] px-3 py-2 text-[12px] font-semibold text-slate-300 transition hover:text-indigo-300"
          title="대본을 자막으로 가져오기"
        >
          <Captions className="size-3.5" /> 자막 가져오기
        </button>
        <button
          onClick={() => {
            if (confirm("새 프로젝트를 시작할까요? 현재 작업은 사라집니다.")) {
              actions.newProject(store.getState().project.aspect);
            }
          }}
          className="flex items-center gap-1.5 rounded-lg border border-[#1d2845] bg-[#0a101f] px-3 py-2 text-[12px] font-semibold text-slate-300 transition hover:text-indigo-300"
          title="새 프로젝트"
        >
          <FilePlus2 className="size-3.5" /> 새로
        </button>
        <button
          onClick={runExport}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-blue-600 px-4 py-2 text-[12px] font-bold text-white shadow-[0_0_16px_rgba(79,90,245,0.45)] transition hover:brightness-110 disabled:opacity-60"
        >
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {exporting
            ? stage === "transcode"
              ? "MP4 변환 중…"
              : `내보내는 중 ${Math.round(progress * 100)}%`
            : "MP4 내보내기"}
        </button>
      </div>

      {exporting && (
        <ExportOverlay
          progress={progress}
          stage={stage}
          onCancel={() => abortRef.current?.abort()}
        />
      )}
      {showSub && <SubtitleImportModal onClose={() => setShowSub(false)} />}
    </header>
  );
}

function ExportOverlay({
  progress,
  stage,
  onCancel,
}: {
  progress: number;
  stage: "render" | "transcode";
  onCancel: () => void;
}) {
  const transcoding = stage === "transcode";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[340px] rounded-2xl border border-[#1d2845] bg-[#0a101f] p-6 text-center">
        <Loader2 className="mx-auto mb-3 size-8 animate-spin text-indigo-400" />
        <p className="text-[14px] font-bold text-slate-100">
          {transcoding ? "MP4로 변환 중…" : "영상을 실시간 녹화 중…"}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          {transcoding
            ? "ffmpeg 로 H.264 mp4 를 만드는 중입니다. 잠시만 기다려 주세요."
            : "미리보기와 동일하게 렌더링됩니다. 탭을 활성 상태로 두세요."}
        </p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#141b2e]">
          {transcoding ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-indigo-500 to-blue-500" />
          ) : (
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          )}
        </div>
        {!transcoding && (
          <p className="mt-2 font-mono text-[12px] text-slate-400">
            {Math.round(progress * 100)}%
          </p>
        )}
        <button
          onClick={onCancel}
          className="mt-4 rounded-lg border border-[#1d2845] px-4 py-1.5 text-[12px] font-semibold text-slate-400 hover:text-rose-300"
        >
          취소
        </button>
      </div>
    </div>
  );
}

function SubtitleImportModal({ onClose }: { onClose: () => void }) {
  const actions = useActions();
  const [text, setText] = useState(() => {
    try {
      const saved = localStorage.getItem(SCRIPT_KEY);
      return saved ? stripMarkdown(saved) : "";
    } catch {
      return "";
    }
  });
  const [perLine, setPerLine] = useState(2.5);

  const apply = () => {
    const lines = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    actions.importSubtitles(lines, perLine);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-[520px] flex-col rounded-2xl border border-[#1d2845] bg-[#0a101f] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[14px] font-bold text-slate-100">
            <Captions className="size-4 text-indigo-400" /> 대본 → 자막 가져오기
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
          한 줄이 자막 한 컷이 됩니다. 대본 스튜디오에서 생성한 원고가 있으면 자동으로 채워집니다.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={"첫 번째 자막 문장\n두 번째 자막 문장\n..."}
          className="inp min-h-0 flex-1 resize-none font-sans"
        />
        <div className="mt-3 flex items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-slate-400">
            컷당 길이
            <input
              type="number"
              value={perLine}
              step={0.5}
              min={0.5}
              onChange={(e) => setPerLine(Math.max(0.5, parseFloat(e.target.value) || 2.5))}
              className="h-8 w-16 rounded-md border border-[#1d2845] bg-[#070b16] px-2 text-center text-[12px] text-slate-200 outline-none"
            />
            초
          </label>
          <button
            onClick={apply}
            className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-[12px] font-bold text-white hover:brightness-110"
          >
            자막 생성
          </button>
        </div>
      </div>
    </div>
  );
}

function stripMarkdown(s: string): string {
  return s
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>#-]+/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function TBtn({
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
      className={`flex size-9 items-center justify-center rounded-lg border transition disabled:opacity-40 ${
        active
          ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
          : "border-[#1d2845] bg-[#0a101f] text-slate-400 hover:text-indigo-300"
      }`}
    >
      {children}
    </button>
  );
}
