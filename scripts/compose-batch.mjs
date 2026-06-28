#!/usr/bin/env node
/**
 * 폴더 안 모든 영상을 해숏티 릴스 템플릿으로 일괄 변환.
 * 브라우저를 1회만 띄워 재사용 → 빠름. 이미 변환된 건 건너뜀(이어하기 가능).
 *
 * 사용:  node scripts/compose-batch.mjs <폴더> [출력폴더] [--stt]
 * 기본:  STT 끔(다운로드 쇼츠는 자막이 이미 있는 경우가 많음). --stt 로 켤 수 있음.
 */
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, extname } from "node:path";

const exec = promisify(execFile);
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "/opt/homebrew/bin/ffprobe";
const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const W = 1080;
const H = 1920;
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);

const args = process.argv.slice(2);
const useStt = args.includes("--stt");
const flip = args.includes("--flip");
const pos = args.filter((a) => !a.startsWith("--"));
const folder = pos[0];
if (!folder) {
  console.error("사용법: node scripts/compose-batch.mjs <폴더> [출력폴더] [--stt] [--flip]");
  process.exit(1);
}
const outDir = pos[1] || join(folder, "output");

function titleFromFilename(path) {
  return basename(path, extname(path))
    .replace(/^\d{6,8}[_-]/, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .trim();
}

// 영상 전체를 샘플해 상·하단 어두운 띠(거의 검정 포함)를 감지. 가로는 무시(콘텐츠는 풀폭).
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

async function renderOverlay(page, title, footerY, headerY) {
  const url =
    `${BASE_URL}/overlay?title=${encodeURIComponent(title)}` +
    (footerY ? `&footerY=${footerY.toFixed(4)}` : "") +
    (headerY ? `&headerY=${headerY.toFixed(4)}` : "");
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__overlayReady === true, { timeout: 20000 });
  const dataUrl = await page.evaluate(() => window.__overlay);
  return dataUrl.replace(/^data:image\/png;base64,/, "");
}

async function transcribe(path) {
  const buf = await readFile(path);
  const fd = new FormData();
  fd.append("file", new Blob([buf]), basename(path));
  fd.append("lang", "ko");
  const res = await fetch(`${BASE_URL}/api/transcribe`, { method: "POST", body: fd });
  if (!res.ok) return [];
  return (await res.json()).segments || [];
}

function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}
function buildAss(segments) {
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Sub,Apple SD Gothic Neo,60,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,6,0,2,70,70,510,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return head + segments.filter((s) => (s.text || "").trim()).map((s) => `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Sub,,0,0,0,,${s.text.replace(/\s+/g, " ").trim()}`).join("\n") + "\n";
}

const HEADER_PX = Math.round(H * 0.255); // 490 — 흰 헤더(로고+제목)
const FOOTER_PX = Math.round(H * 0.8); //  1536 — 하단 흰밴드 시작
const AREA_H = FOOTER_PX - HEADER_PX; //   1046 — 영상이 채울 높이

async function composeOne(page, input, output) {
  const title = titleFromFilename(input);
  // 콘텐츠 영역(레터박스 제외) 감지 → 잘라내 헤더~하단밴드 사이를 꽉 채운다
  const content = (await detectContent(input)) || { y: 0, h: H };
  // 헤더를 콘텐츠 위로 살짝 겹쳐(0.36) 원본 영상의 자체 제목/어두운 바를 가린다
  const pngB64 = await renderOverlay(page, title, 0.8, 0.36);

  let segments = [];
  if (useStt) {
    try { segments = await transcribe(input); } catch { /* skip */ }
  }

  const dir = await mkdtemp(join(tmpdir(), "batch-"));
  try {
    const overlay = join(dir, "o.png");
    await writeFile(overlay, Buffer.from(pngB64, "base64"));
    const vf = [
      `[0:v]${flip ? "hflip," : ""}crop=${W}:${content.h}:0:${content.y},scale=${W}:${AREA_H}:force_original_aspect_ratio=increase,crop=${W}:${AREA_H},setsar=1,pad=${W}:${H}:0:${HEADER_PX}:color=white[base]`,
      `[base][1:v]overlay=0:0:format=auto[ov]`,
    ];
    let last = "ov";
    if (segments.length) {
      const ass = join(dir, "s.ass");
      await writeFile(ass, buildAss(segments), "utf8");
      vf.push(`[ov]ass=${ass}[v]`);
      last = "v";
    }
    await exec(
      FFMPEG,
      [
        "-i", input, "-i", overlay, "-filter_complex", vf.join(";"),
        "-map", `[${last}]`, "-map", "0:a?",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "21",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", output,
      ],
      { maxBuffer: 1024 * 1024 * 64 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const entries = await readdir(folder);
  const videos = [];
  for (const e of entries) {
    if (VIDEO_EXT.has(extname(e).toLowerCase())) {
      const p = join(folder, e);
      if ((await stat(p)).isFile()) videos.push(p);
    }
  }
  videos.sort();
  await mkdir(outDir, { recursive: true });
  console.log(`📁 ${videos.length}개 영상 · 출력: ${outDir} · STT: ${useStt ? "켬" : "끔"} · 좌우반전: ${flip ? "켬" : "끔"}\n`);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  let done = 0, skipped = 0, failed = 0;
  const t0 = Date.now();
  try {
    for (let i = 0; i < videos.length; i++) {
      const input = videos[i];
      const output = join(outDir, `${basename(input, extname(input))}-해숏티.mp4`);
      const tag = `[${i + 1}/${videos.length}]`;
      if (existsSync(output)) {
        skipped++;
        console.log(`${tag} ⏭  이미 있음: ${basename(output)}`);
        continue;
      }
      try {
        await composeOne(page, input, output);
        done++;
        console.log(`${tag} ✅ ${basename(output)}`);
      } catch (e) {
        failed++;
        console.log(`${tag} ❌ ${basename(input)} — ${e.message.slice(0, 80)}`);
      }
    }
  } finally {
    await browser.close();
  }
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n🎉 완료: 변환 ${done} · 건너뜀 ${skipped} · 실패 ${failed} · ${mins}분`);
}

main().catch((e) => {
  console.error("❌ 배치 실패:", e.message);
  process.exit(1);
});
