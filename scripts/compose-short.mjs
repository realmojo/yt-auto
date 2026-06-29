#!/usr/bin/env node
/**
 * 해숏티 릴스 자동 합성기.
 * 영상 파일 하나 → 해숏티 템플릿(헤더+제목) 입히고 + 음성 자막(whisper STT) 자동 → MP4.
 *
 * 사용:  node scripts/compose-short.mjs "<영상 경로>"  [출력 경로]  [--no-stt]
 * 필요:  dev 서버 실행(localhost:3000) · ffmpeg · 시스템 Chrome · whisper.cpp(STT용)
 */
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, extname } from "node:path";

const exec = promisify(execFile);
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "/opt/homebrew/bin/ffprobe";
const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const W = 1080;
const H = 1920;

const raw = process.argv.slice(2);
let noStt = false;
let flip = false;
let titleOverride = null;
const positional = [];
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === "--no-stt") noStt = true;
  else if (raw[i] === "--flip") flip = true;
  else if (raw[i] === "--title") titleOverride = raw[++i] ?? null;
  else positional.push(raw[i]);
}
const input = positional[0];
if (!input) {
  console.error(
    '사용법: node scripts/compose-short.mjs "<영상>" [출력] [--title "제목"] [--no-stt] [--flip]',
  );
  process.exit(1);
}
const out =
  positional[1] || join(dirname(input), `${basename(input, extname(input))}-해숏티.mp4`);

/** 파일명 → 제목 (날짜 접두/[id] 접미/확장자 제거) */
function titleFromFilename(path) {
  return basename(path, extname(path))
    .replace(/^\d{6,8}[_-]/, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .trim();
}

async function probeDuration(path) {
  const { stdout } = await exec(FFPROBE, [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

/** 영상 전체 샘플로 상·하단 어두운 띠(거의 검정 포함) 감지. 가로 무시(콘텐츠는 풀폭). */
async function detectContent(path) {
  try {
    const { stderr } = await exec(
      FFMPEG,
      ["-i", path, "-vf", "select='not(mod(n,20))',cropdetect=80:2:0", "-vsync", "vfr", "-frames:v", "80", "-f", "null", "-"],
      { maxBuffer: 1024 * 1024 * 32 },
    );
    const tops = {}, bots = {};
    for (const m of stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)) {
      const h = +m[2], y = +m[4];
      tops[y] = (tops[y] || 0) + 1;
      bots[y + h] = (bots[y + h] || 0) + 1;
    }
    const top = Number(Object.entries(tops).sort((a, b) => b[1] - a[1])[0]?.[0]);
    const bottom = Number(Object.entries(bots).sort((a, b) => b[1] - a[1])[0]?.[0]);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return null;
    return { y: top, h: bottom - top };
  } catch {
    return null;
  }
}

/** 헤드리스 브라우저로 /overlay 렌더 → 투명 오버레이 PNG(base64) */
async function renderOverlay(title, footerY, headerY) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const url =
      `${BASE_URL}/overlay?title=${encodeURIComponent(title)}` +
      (footerY ? `&footerY=${footerY.toFixed(4)}` : "") +
      (headerY ? `&headerY=${headerY.toFixed(4)}` : "");
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__overlayReady === true, { timeout: 20000 });
    const dataUrl = await page.evaluate(() => window.__overlay);
    return dataUrl.replace(/^data:image\/png;base64,/, "");
  } finally {
    await browser.close();
  }
}

/** whisper STT (/api/transcribe) → 타이밍 세그먼트 */
async function transcribe(path) {
  const buf = await readFile(path);
  const fd = new FormData();
  fd.append("file", new Blob([buf]), basename(path));
  fd.append("lang", "ko");
  const res = await fetch(`${BASE_URL}/api/transcribe`, { method: "POST", body: fd });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `STT 실패 (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data.segments || [];
}

function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** 해숏티 중앙 자막 스타일(흰색 굵게 + 검정 외곽선, y≈0.72)에 맞춘 ASS */
function buildAss(segments) {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Apple SD Gothic Neo,60,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,6,0,2,70,70,510,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = segments
    .filter((s) => (s.text || "").trim())
    .map(
      (s) =>
        `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Sub,,0,0,0,,${s.text.replace(/\s+/g, " ").trim()}`,
    )
    .join("\n");
  return head + lines + "\n";
}

async function main() {
  const title = titleOverride ?? titleFromFilename(input);
  console.log(`🎬 제목: ${title}`);
  const dur = await probeDuration(input);
  console.log(`⏱  길이: ${dur.toFixed(1)}초`);

  // 영상 콘텐츠 영역(레터박스 제외) 감지 → 잘라내 헤더~하단밴드 사이를 꽉 채운다
  const content0 = (await detectContent(input)) || { y: 0, h: H };
  // 원본 상단에 박힌 자막(예: "차별 받았다는 중국인")을 잘라낸다.
  // 정사각 헤더(420)는 이 자막을 못 가리므로, 콘텐츠 상단 일부를 떼어내 정사각을 채운다(약간 확대됨).
  // 비율은 영상마다 다를 수 있어 CAP_CROP 환경변수(0~0.4)로 조정 가능. 기본 0.25.
  const capFrac = Math.min(0.4, Math.max(0, Number(process.env.CAP_CROP ?? 0.25)));
  const cap = Math.round(content0.h * capFrac);
  const content = { y: content0.y + cap, h: content0.h - cap };
  // 1:1 정사각 영상을 프레임 정중앙에: 상단 흰 420 / 영상 1080×1080 / 하단 흰 420
  const HEADER_PX = Math.round((H - W) / 2); // 420 — 상단 흰 헤더(로고+제목)
  const AREA_H = W; //                          1080 — 영상(정사각, 전체폭)
  const FOOTER_PX = HEADER_PX + AREA_H; //      1500 — 하단 흰밴드 시작
  console.log(`📐 콘텐츠 ${content0.y}~${content0.y + content0.h}px · 상단자막 ${cap}px 크롭 → 영상영역 ${HEADER_PX}~${FOOTER_PX}px 채움`);

  console.log("🖼  해숏티 오버레이 렌더 중…");
  // 헤더/푸터를 영상 정사각 위·아래 흰 영역(각 420px)에 맞춘다
  const pngB64 = await renderOverlay(title, FOOTER_PX / H, HEADER_PX / H);

  let segments = [];
  if (!noStt) {
    console.log("🎙  음성 자막(STT) 생성 중…");
    try {
      segments = await transcribe(input);
      console.log(`   자막 ${segments.length}개`);
    } catch (e) {
      console.warn(`   ⚠️ STT 건너뜀: ${e.message}`);
    }
  }

  const dir = await mkdtemp(join(tmpdir(), "compose-"));
  const overlay = join(dir, "overlay.png");
  await writeFile(overlay, Buffer.from(pngB64, "base64"));

  const vf = [
    `[0:v]${flip ? "hflip," : ""}crop=${W}:${content.h}:0:${content.y},scale=${W}:${AREA_H}:force_original_aspect_ratio=increase,crop=${W}:${AREA_H},setsar=1,pad=${W}:${H}:0:${HEADER_PX}:color=white[base]`,
    `[base][1:v]overlay=0:0:format=auto[ov]`,
  ];
  let lastLabel = "ov";
  if (segments.length) {
    const ass = join(dir, "subs.ass");
    await writeFile(ass, buildAss(segments), "utf8");
    vf.push(`[ov]ass=${ass}[v]`);
    lastLabel = "v";
  }

  console.log("🎞  ffmpeg 합성 중…");
  try {
    await exec(
      FFMPEG,
      [
        "-i", input,
        "-i", overlay,
        "-filter_complex", vf.join(";"),
        "-map", `[${lastLabel}]`,
        "-map", "0:a?",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "21",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", out,
      ],
      { maxBuffer: 1024 * 1024 * 64 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  console.log(`✅ 완료: ${out}`);
}

main().catch((e) => {
  console.error("❌ 실패:", e.message);
  process.exit(1);
});
