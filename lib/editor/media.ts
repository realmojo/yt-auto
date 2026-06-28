import { clamp } from "./geometry";
import { isActiveAt } from "./geometry";
import type { RenderResolver } from "./render";
import type { MediaAsset, MediaClip, Project, Track } from "./types";

const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * 프로젝트의 미디어 엘리먼트(video/audio/image)를 관리하고
 * 주어진 시각에 맞춰 seek/play/pause/volume 을 동기화한다.
 * 미리보기용(직접 출력)과 export용(WebAudio 라우팅)이 각각 별도 인스턴스를 갖는다.
 *
 * 엘리먼트는 클립 id 가 아니라 **에셋(assetId)** 기준으로 공유한다.
 * → 같은 소스를 자른 두 절반(연속 구간)이 하나의 엘리먼트를 공유해
 *   컷 지점에서 재로드/seek 없이 이어 재생되므로 깜빡임이 없다.
 */
export class MediaController {
  private videos = new Map<string, HTMLVideoElement>(); // key: assetId
  private audios = new Map<string, HTMLAudioElement>(); // key: assetId
  private images = new Map<string, HTMLImageElement>(); // key: assetId
  private clipToAsset = new Map<string, string>(); // clipId -> assetId
  private connected = new Set<HTMLMediaElement>();
  private forExport: boolean;

  constructor(opts: { forExport?: boolean } = {}) {
    this.forExport = opts.forExport ?? false;
  }

  /** 프로젝트/에셋에 맞춰 엘리먼트 생성·정리 */
  ensure(project: Project, assets: MediaAsset[]) {
    const wantVideo = new Set<string>();
    const wantAudio = new Set<string>();
    const wantImage = new Set<string>();
    this.clipToAsset.clear();

    for (const clip of project.clips) {
      if (clip.type === "video") {
        this.clipToAsset.set(clip.id, clip.assetId);
        wantVideo.add(clip.assetId);
        if (!this.videos.has(clip.assetId)) {
          this.videos.set(clip.assetId, this.createVideo(clip.src));
        }
      } else if (clip.type === "audio") {
        this.clipToAsset.set(clip.id, clip.assetId);
        wantAudio.add(clip.assetId);
        if (!this.audios.has(clip.assetId)) {
          this.audios.set(clip.assetId, this.createAudio(clip.src));
        }
      } else if (clip.type === "image") {
        const asset = assets.find((a) => a.id === clip.assetId);
        const src = asset?.url ?? clip.src;
        wantImage.add(clip.assetId);
        if (!this.images.has(clip.assetId)) {
          const img = new Image();
          img.decoding = "async";
          img.src = src;
          this.images.set(clip.assetId, img);
        }
      }
    }

    for (const [id, el] of this.videos)
      if (!wantVideo.has(id)) {
        el.pause();
        this.videos.delete(id);
      }
    for (const [id, el] of this.audios)
      if (!wantAudio.has(id)) {
        el.pause();
        this.audios.delete(id);
      }
    for (const [id] of this.images)
      if (!wantImage.has(id)) this.images.delete(id);
  }

  private createVideo(src: string): HTMLVideoElement {
    const v = document.createElement("video");
    v.src = src;
    v.preload = "auto";
    v.playsInline = true;
    v.muted = false;
    // 동일 출처 objectURL 이므로 캔버스 오염 없음
    return v;
  }

  private createAudio(src: string): HTMLAudioElement {
    const a = document.createElement("audio");
    a.src = src;
    a.preload = "auto";
    return a;
  }

  /** time(초) 시점에 모든 미디어를 동기화 (에셋별로 활성 클립 하나가 엘리먼트를 구동) */
  sync(project: Project, time: number, playing: boolean) {
    this.syncKind(project, time, playing, "video");
    this.syncKind(project, time, playing, "audio");
  }

  private syncKind(
    project: Project,
    time: number,
    playing: boolean,
    kind: "video" | "audio",
  ) {
    const map: Map<string, HTMLMediaElement> =
      kind === "video" ? this.videos : this.audios;

    // 에셋별로 현재 활성인 클립 1개를 고른다
    const activeByAsset = new Map<string, { clip: MediaClip; track: Track | null }>();
    for (const clip of project.clips) {
      if (clip.type !== kind) continue;
      const assetId = clip.assetId;
      if (!map.has(assetId) || activeByAsset.has(assetId)) continue;
      if (isActiveAt(clip, time)) {
        const track = project.tracks.find((t) => t.id === clip.trackId) ?? null;
        activeByAsset.set(assetId, { clip: clip as MediaClip, track });
      }
    }

    for (const [assetId, el] of map) {
      const active = activeByAsset.get(assetId);
      if (active) {
        this.syncMedia(el, active.clip, active.track, time, playing);
      } else if (!el.paused) {
        el.pause();
      }
    }
  }

  private syncMedia(
    el: HTMLMediaElement,
    clip: MediaClip,
    track: Track | null,
    time: number,
    playing: boolean,
  ) {
    const silent = clip.muted || (track?.muted ?? false);
    el.volume = silent ? 0 : clamp01(clip.volume);
    // export 시에는 WebAudio gain 으로 처리하므로 element.muted 는 항상 false
    el.muted = this.forExport ? false : silent;

    // 잘린 두 절반은 trimStart 가 이어져 있어 desired 가 컷 지점에서 연속 → seek 불필요
    const desired = clip.trimStart + (time - clip.start);

    if (playing) {
      if (el.paused) {
        this.seek(el, desired);
        void el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - desired) > 0.3) {
        this.seek(el, desired);
      }
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - desired) > 0.05) this.seek(el, desired);
    }
  }

  private seek(el: HTMLMediaElement, t: number) {
    const dur = Number.isFinite(el.duration) ? el.duration : Infinity;
    const target = clamp(t, 0, Math.max(0, Math.min(dur, t + 1e6)));
    if (Number.isFinite(target)) {
      try {
        el.currentTime = target;
      } catch {
        /* seek 불가 상태 무시 */
      }
    }
  }

  /** 모든 미디어 일시정지 */
  pauseAll() {
    for (const el of this.videos.values()) el.pause();
    for (const el of this.audios.values()) el.pause();
  }

  resolver(): RenderResolver {
    return {
      getImage: (assetId) => this.images.get(assetId) ?? null,
      getVideo: (clipId) => {
        const assetId = this.clipToAsset.get(clipId);
        return assetId ? (this.videos.get(assetId) ?? null) : null;
      },
    };
  }

  /** export 전용: 모든 오디오 트랙을 WebAudio 그래프에 연결 */
  connectAudio(ctx: AudioContext, dest: AudioNode) {
    const all: HTMLMediaElement[] = [
      ...this.videos.values(),
      ...this.audios.values(),
    ];
    for (const el of all) {
      if (this.connected.has(el)) continue;
      try {
        const node = ctx.createMediaElementSource(el);
        node.connect(dest);
        this.connected.add(el);
      } catch {
        /* 이미 연결됨 등 무시 */
      }
    }
  }

  /** 모든 미디어가 프레임 데이터를 읽을 때까지 대기 */
  async waitReady(timeoutMs = 8000): Promise<void> {
    const els: HTMLMediaElement[] = [
      ...this.videos.values(),
      ...this.audios.values(),
    ];
    const waits = els.map(
      (el) =>
        new Promise<void>((resolve) => {
          // HAVE_CURRENT_DATA(2): 렌더러(drawVideoClip)가 실제 프레임을 그릴 수 있는 상태.
          // metadata(1)만으로는 export 첫 프레임에 placeholder 가 녹화될 수 있다.
          if (el.readyState >= 2) return resolve();
          const done = () => {
            el.removeEventListener("loadeddata", done);
            el.removeEventListener("canplay", done);
            resolve();
          };
          el.addEventListener("loadeddata", done);
          el.addEventListener("canplay", done);
        }),
    );
    const imgWaits = [...this.images.values()].map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          const done = () => resolve();
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
        }),
    );
    const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs));
    await Promise.race([Promise.all([...waits, ...imgWaits]), timeout]);
  }

  dispose() {
    this.pauseAll();
    this.videos.clear();
    this.audios.clear();
    this.images.clear();
    this.clipToAsset.clear();
    this.connected.clear();
  }
}
