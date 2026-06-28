import { MediaController } from "./media";
import { drawFrame } from "./render";
import type { EditorStore } from "./store";

export interface ExportOptions {
  fps?: number;
  /** 0..1 진행률 */
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
  /** 비트레이트 (기본 화질↔용량 자동) */
  videoBitsPerSecond?: number;
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  ext: string;
}

const MIME_CANDIDATES = [
  // mp4 를 지원하는 브라우저(Safari·최신 Chrome 등)면 네이티브로 mp4 녹화
  "video/mp4;codecs=avc1.640029,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=h264,aac",
  "video/mp4",
  // 그 외(대부분의 Chrome)는 webm 녹화 → 서버에서 mp4 로 변환
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm",
];

function pickMime(): { mime: string; ext: string } {
  if (typeof MediaRecorder === "undefined") {
    return { mime: "", ext: "webm" };
  }
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) {
      return { mime: m, ext: m.includes("mp4") ? "mp4" : "webm" };
    }
  }
  return { mime: "", ext: "webm" };
}

export function isExportSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

/**
 * 프로젝트를 실시간 재생하며 캔버스 스트림 + 오디오 믹스를 MediaRecorder 로 녹화한다.
 * 미리보기와 동일한 drawFrame 렌더러를 재사용하므로 결과물이 화면과 일치한다.
 */
export async function exportProject(
  store: EditorStore,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  if (!isExportSupported()) {
    throw new Error("이 브라우저는 영상 내보내기(MediaRecorder)를 지원하지 않습니다.");
  }

  const { project, assets } = store.getState();
  const fps = opts.fps ?? project.fps;
  const duration = project.duration;

  const canvas = document.createElement("canvas");
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("캔버스 컨텍스트를 만들 수 없습니다.");

  const controller = new MediaController({ forExport: true });
  controller.ensure(project, assets);
  await controller.waitReady();
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* noop */
    }
  }

  // 오디오 믹스
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const audioCtx = new AC();
  const dest = audioCtx.createMediaStreamDestination();
  controller.connectAudio(audioCtx, dest);
  await audioCtx.resume().catch(() => {});

  const videoStream = canvas.captureStream(fps);
  const audioTracks = dest.stream.getAudioTracks();
  const stream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...audioTracks,
  ]);

  const { mime, ext } = pickMime();
  const bitrate =
    opts.videoBitsPerSecond ??
    Math.round(project.width * project.height * fps * 0.12);
  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime, videoBitsPerSecond: bitrate } : undefined,
  );
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const resolver = controller.resolver();
  const drawAt = (t: number) =>
    drawFrame(ctx, store.getState().project, t, { renderScale: 1, resolver });

  // 첫 프레임 준비: t=0 의 활성 클립을 seek 한 뒤 디코드될 시간을 약간 준다 (placeholder flash 방지)
  controller.sync(project, 0, false);
  await new Promise((r) => setTimeout(r, 150));
  drawAt(0);

  const finished = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const start = performance.now();
  let aborted = false;

  try {
    recorder.start();

    await new Promise<void>((resolve) => {
      const tick = () => {
        if (opts.signal?.aborted) {
          aborted = true;
          resolve();
          return;
        }
        const elapsed = (performance.now() - start) / 1000;
        const t = Math.min(elapsed, duration);
        controller.sync(store.getState().project, t, true);
        drawAt(t);
        opts.onProgress?.(duration > 0 ? t / duration : 1);
        if (elapsed >= duration) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    controller.pauseAll();
    recorder.stop();
    await finished;

    if (aborted) {
      throw new DOMException("내보내기가 취소되었습니다.", "AbortError");
    }

    const blob = new Blob(chunks, { type: mime || "video/webm" });
    return { blob, mime: mime || "video/webm", ext };
  } finally {
    // 정상/예외/취소 모두에서 리소스 정리 (해제 누수 방지)
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* noop */
    }
    controller.dispose();
    audioCtx.close().catch(() => {});
    videoStream.getTracks().forEach((t) => t.stop());
  }
}

/** Blob 다운로드 트리거 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
