"use client";

/**
 * 브라우저가 이 영상(object URL)의 프레임을 실제로 디코드/렌더할 수 있는지 검사.
 * HEVC·10bit·AV1 등 미지원 코덱이거나 하드웨어 가속이 꺼져 있으면 false.
 * (사용자의 실제 브라우저에서 실행되므로 환경에 맞게 판별된다.)
 */
export function isVideoDecodable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute("src");
      try {
        v.load();
      } catch {
        /* noop */
      }
      resolve(ok);
    };

    v.addEventListener("error", () => finish(false));
    v.addEventListener("loadeddata", () => {
      if (v.videoWidth === 0 || v.videoHeight === 0) return finish(false);
      // 첫 프레임으로 seek → 실제 디코드 시도
      const dur = Number.isFinite(v.duration) ? v.duration : 1;
      v.currentTime = Math.min(0.1, dur / 2);
    });
    v.addEventListener("seeked", () => {
      try {
        const c = document.createElement("canvas");
        c.width = 8;
        c.height = 8;
        const ctx = c.getContext("2d");
        if (!ctx) return finish(true);
        ctx.drawImage(v, 0, 0, 8, 8); // 디코드 실패면 그려지지 않음
        ctx.getImageData(0, 0, 8, 8); // 접근 가능 = OK
        finish(true);
      } catch {
        finish(false);
      }
    });

    // 메타데이터조차 못 받으면(대개 디코드 불가) 실패 처리
    const timer = setTimeout(
      () => finish(v.videoWidth > 0 && v.videoHeight > 0),
      5000,
    );
    v.src = url;
  });
}

/** 영상 파일을 서버(ffmpeg)에서 H.264로 변환해 새 File 로 반환 */
export async function transcodeToH264(file: File): Promise<File> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/transcode-video", { method: "POST", body: fd });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || "영상 변환에 실패했습니다.");
  }
  const blob = await res.blob();
  const base = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${base}-h264.mp4`, { type: "video/mp4" });
}
