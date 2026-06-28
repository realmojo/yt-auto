import { makeProject, makeVideoClip } from "./factory";
import { TEMPLATES, templateContext } from "./templates";
import type { MediaAsset, Project } from "./types";

const TITLE = "중국국기 없다고 난동부리는 중국인의 최후 ㄷㄷ";
const DURATION = 28.03; // 원본 길이(초)

const SEED_VIDEO: MediaAsset = {
  id: "ast_seed_china",
  kind: "video",
  name: TITLE,
  url: "/demo/china-flag.mp4", // public/demo/china-flag.mp4
  duration: DURATION,
  width: 1080,
  height: 1920,
};

/**
 * 에디터 초기 프로젝트:
 * - 해숏티 릴스 템플릿 적용
 * - 중국국기 영상을 전체 화면 배경으로
 * - 파일명을 제목 텍스트로
 */
export function buildSeedProject(): { project: Project; assets: MediaAsset[] } {
  const base = makeProject("9:16");
  const tpl = TEMPLATES.find((t) => t.id === "haesyotti-reels");

  // 템플릿 클립을 영상 길이에 맞춰 생성하고, 제목 텍스트를 파일명으로 교체
  const ctx = templateContext({ ...base, duration: DURATION });
  const templateClips = (tpl ? tpl.build(ctx) : []).map((c) =>
    c.type === "text" && c.name === "제목" ? { ...c, text: TITLE } : c,
  );

  const videoTrack = base.tracks.find((t) => t.kind === "video") ?? base.tracks[0];
  const video = makeVideoClip(videoTrack.id, SEED_VIDEO, base.width, base.height, {
    start: 0,
    x: 0,
    y: 0,
    width: base.width,
    height: base.height,
    objectFit: "cover",
    duration: DURATION,
  });

  const project: Project = {
    ...base,
    background: tpl?.background ?? base.background,
    // 비디오는 비디오 트랙(맨 아래)에, 템플릿 클립은 오버레이·텍스트 트랙(위)에
    clips: [video, ...templateClips],
    duration: DURATION,
  };

  return { project, assets: [SEED_VIDEO] };
}

/**
 * 영상 없이 해숏티 템플릿 오버레이만 있는 프로젝트 (서버 자동 합성용 — 투명 PNG 렌더).
 * 제목만 동적으로 받는다.
 */
/** 자동 합성 오버레이에서 뺄 자리표시자(자막 텍스트만 — 흰 헤더·하단 밴드는 유지) */
const OVERLAY_OMIT = new Set(["중앙 자막", "하단 자막"]);

export function buildOverlayProject(
  title: string,
  durationSec = 5,
  footerYFrac = 0.8,
  headerYFrac = 0,
): Project {
  const base = makeProject("9:16");
  const tpl = TEMPLATES.find((t) => t.id === "haesyotti-reels");
  const ctx = templateContext({ ...base, duration: durationSec });
  const footerY = Math.round(base.height * footerYFrac);
  // 헤더 밴드는 영상 콘텐츠 시작점(상단 레터박스)까지 내려 검정을 덮는다. 최소 기본 높이 보장.
  const headerH = Math.max(
    Math.round(base.height * 0.255),
    Math.round(base.height * headerYFrac),
  );
  const titleH = Math.round(base.height * 0.13);
  const titleY = Math.max(Math.round(base.height * 0.155), headerH - titleH);
  const clips = (tpl ? tpl.build(ctx) : [])
    .filter((c) => !OVERLAY_OMIT.has(c.name))
    .map((c) => {
      // 제목: 텍스트 교체 + 영상 바로 위로 위치
      if (c.type === "text" && c.name === "제목") {
        return { ...c, text: title, y: titleY, height: titleH };
      }
      // 상단 흰 밴드: 영상 콘텐츠 시작까지 덮기
      if (c.type === "shape" && c.name === "헤더 배경") {
        return { ...c, height: headerH };
      }
      // 하단 흰 밴드: 영상 콘텐츠 끝부터 덮기
      if (c.type === "shape" && c.name === "하단 배경") {
        return { ...c, y: footerY, height: base.height - footerY };
      }
      return c;
    });
  return { ...base, clips, duration: durationSec };
}
