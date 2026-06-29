#!/usr/bin/env node
/**
 * auto-episode — 에피소드 1편을 사람 손 없이 끝까지 만든다.
 *
 *   request.json → (1) /api/script[Claude]      → script.md
 *               → (2) pipeline/build-episode.mjs → episode.json + narration.mp3
 *               → (3) scripts/render-episode.mjs → final.mp4
 *               → (4, --upload) output/ 복사 후 youtube-upload
 *
 * 기존 스크립트를 그대로 엮는 오케스트레이터다(빌더·렌더·업로드는 재구현하지 않음).
 *
 * 사용:  node scripts/auto-episode.mjs <episodeDir> [--force] [--frames N] [--upload]
 *   --force   : script.md 가 있어도 대본을 다시 생성
 *   --frames N: 렌더를 앞 N프레임만(빠른 검증). 생략 시 풀렌더
 *   --upload  : final.mp4 를 output/ 으로 복사하고 youtube-upload 실행
 *
 * 필요: dev 서버(/api/script)·ANTHROPIC_API_KEY · macOS say · ffmpeg · 시스템 Chrome.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, access, copyFile, mkdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";

const execFileP = promisify(execFile);
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ROOT = resolve(new URL("..", import.meta.url).pathname);

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith("--"));
if (!dirArg) {
  console.error("사용법: node scripts/auto-episode.mjs <episodeDir> [--force] [--frames N] [--upload]");
  process.exit(1);
}
const episodeDir = resolve(dirArg);
const force = args.includes("--force");
const upload = args.includes("--upload");
const framesIdx = args.indexOf("--frames");
const frames = framesIdx >= 0 ? args[framesIdx + 1] : null;

const exists = (p) => access(p).then(() => true).catch(() => false);

/** 자식 스크립트를 node 로 실행하고 stdout 를 흘려보낸다 */
async function runNode(scriptRel, scriptArgs) {
  const { stdout } = await execFileP("node", [join(ROOT, scriptRel), ...scriptArgs], {
    cwd: ROOT,
    env: process.env,
    maxBuffer: 1024 * 1024 * 64,
  });
  process.stdout.write(stdout);
}

/** (1) 대본 생성 — request.json 을 /api/script 로 보내 script.md 캡처. engine:"claude" 강제 주입(기본 ollama 회피). */
async function generateScript() {
  const scriptPath = join(episodeDir, "script.md");
  if (!force && (await exists(scriptPath))) {
    console.log("📄 script.md 존재 → 대본 생성 건너뜀 (--force 로 재생성)");
    return;
  }
  const request = JSON.parse(await readFile(join(episodeDir, "request.json"), "utf8"));
  const body = { ...request, engine: "claude" }; // ⚠ 미주입 시 라우트 기본값 ollama 로 빠짐
  console.log(`✍️  대본 생성 (Claude) … 채널="${request.channel ?? "?"}" 분량=${request.lengthMin ?? "?"}분`);

  const res = await fetch(`${BASE_URL}/api/script`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`/api/script 실패 (HTTP ${res.status}). dev 서버·ANTHROPIC_API_KEY 확인. ${detail.slice(0, 200)}`);
  }
  // 라우트는 text/plain 스트림. 오류는 본문에 "> ⚠️ … 오류" 형태로 섞여 온다.
  const md = await res.text();
  if (/^\s*>\s*⚠️?\s*\*\*(오류|Ollama 오류)/m.test(md) || md.trim().length < 50) {
    throw new Error(`대본 생성 응답이 비정상입니다:\n${md.slice(0, 300)}`);
  }
  await writeFile(scriptPath, md, "utf8");
  console.log(`📄 script.md 저장 (${md.length}자)`);
}

/** (2) 빌드 — 기존 pipeline/build-episode.mjs 호출 */
async function build() {
  const buildArgs = [episodeDir];
  if (process.env.TTS_VOICE) buildArgs.push("--voice", process.env.TTS_VOICE);
  if (process.env.TTS_RATE) buildArgs.push("--rate", process.env.TTS_RATE);
  console.log("🔧 episode.json + narration.mp3 빌드 …");
  await runNode("pipeline/build-episode.mjs", buildArgs);
}

/** (3) 렌더 — 기존 scripts/render-episode.mjs 호출 */
async function render() {
  const renderArgs = [episodeDir];
  if (frames) renderArgs.push("--frames", frames);
  console.log(`🎬 렌더${frames ? ` (앞 ${frames}프레임)` : " (풀렌더)"} …`);
  await runNode("scripts/render-episode.mjs", renderArgs);
}

/** (4) 업로드(옵션) */
async function publish() {
  const finalMp4 = join(episodeDir, "final.mp4");
  if (!(await exists(finalMp4))) throw new Error("final.mp4 가 없습니다 (렌더 실패?).");
  const outDir = join(ROOT, "output");
  await mkdir(outDir, { recursive: true });
  const dest = join(outDir, `${basename(episodeDir)}.mp4`);
  await copyFile(finalMp4, dest);
  console.log(`📦 output/ 복사: ${dest}`);
  console.log("⬆️  youtube-upload 실행 …");
  await runNode("scripts/youtube-upload.mjs", []);
}

async function main() {
  console.log(`\n=== auto-episode: ${episodeDir} ===`);
  await generateScript();
  await build();
  await render();
  if (upload) await publish();
  else console.log("\n✅ 완료(업로드 제외). 업로드는 --upload 또는 `npm run yt:upload`.");
}

main().catch((e) => {
  console.error("\n❌ auto-episode 실패:", e.stack || e.message);
  process.exit(1);
});
