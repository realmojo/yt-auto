#!/usr/bin/env node
/**
 * 유튜브 쇼핑 쇼츠 제작 (2단계) — 상품 이미지 + 키워드 → 원본 세로 쇼츠.
 *
 *  1) 대본 생성: Claude(opus)로 키워드 + 상품 이미지(비전) + 샤오홍수 레퍼런스 제목을 근거로
 *     한국어 셀링포인트 대본(JSON) 생성 → shopping/refs/<키워드>/script.json
 *  2) 내레이션: macOS `say`(한국어 음성)로 장면별 음성 → ffmpeg로 합쳐 narration.mp3 + 타이밍
 *  3) 렌더: Remotion "ShoppingShort" 컴포지션으로 세로 1080x1920 mp4
 *
 * 실행:
 *   node shopping/make-short.mjs --keyword "电风扇"                 # 전체(대본→TTS→렌더)
 *   node shopping/make-short.mjs --keyword "电风扇" --voice Suhyun  # 음성 변경
 *   node shopping/make-short.mjs --keyword "电风扇" --skip-script   # 기존 script.json 재사용
 *   node shopping/make-short.mjs --keyword "电风扇" --image ~/a.jpg # 상품 이미지 지정
 *   node shopping/make-short.mjs --keyword "电风扇" --dry-script    # 대본만 생성하고 종료
 *
 * 필요: ANTHROPIC_API_KEY(또는 `ant auth login`) · macOS say(한국어 음성) · ffmpeg · 시스템 Chrome.
 * 레퍼런스는 1단계(rednote-fetch.js)로 shopping/refs/<키워드>/ 에 이미지·index.json 이 있어야 좋다.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  qwenConfigured,
  synthesize as qwenSynthesize,
  loadClonedVoice,
  FLASH_MODEL,
} from "./qwen-tts.mjs";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, basename, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// 스탠드얼론 실행 시에도 .env.local 의 키를 읽는다(Next 앱과 동일한 위치)
try {
  const env = await readFile(resolve(ROOT, ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* .env.local 없으면 무시 */
}
const REFS_DIR = join(__dirname, "refs");
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "/opt/homebrew/bin/ffprobe";
const SAY = process.env.SAY_BIN || "/usr/bin/say";
const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

// ---------- 인자 ----------
const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const KEYWORD = arg("keyword", argv.find((a) => !a.startsWith("--")) || "");
const VOICE = arg("voice", "Yuna"); // macOS say 한국어: Yuna / Suhyun / Minsu / Jian
const TTS = arg("tts", null); // 'qwen' | 'say' | null(자동: 키 있으면 qwen)
const QWEN_VOICE = arg("qwen-voice", "Cherry"); // Qwen 내장 음색(클론 없을 때)
const IMAGE = arg("image", null);
const VIDEO = arg("video", null); // 배경 레퍼런스 영상 경로(미지정 시 refs/<키워드>/videos/ 자동)
const AUDIO = arg("audio", null); // 직접 만든 내레이션 오디오(있으면 TTS 를 건너뛰고 그대로 사용)
const SKIP_SCRIPT = has("skip-script");
const DRY_SCRIPT = has("dry-script");
const FPS = parseInt(arg("fps", "30"), 10);
const GAP = 0.35; // 장면 사이 간격(초)
const TAIL = 0.8; // 마지막 CTA용 여유(초)

// ---------- 유틸 ----------
const slug = (s) =>
  String(s)
    .trim()
    .replace(/[\/\\:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "keyword";

const mediaType = (p) => {
  const e = extname(p).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  return "image/jpeg";
};

async function probeDuration(file) {
  const { stdout } = await exec(FFPROBE, [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return parseFloat(stdout.trim());
}

// ---------- 배경 소스 준비 (영상 우선, 없으면 이미지) ----------
const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;

async function findImage(outDir) {
  if (IMAGE) {
    if (!existsSync(IMAGE)) throw new Error(`이미지를 찾을 수 없음: ${IMAGE}`);
    const dest = join(outDir, "input" + extname(IMAGE));
    await copyFile(IMAGE, dest);
    return dest;
  }
  const files = await readdir(outDir).catch(() => []);
  const hit = files.find((f) => /^input\.(jpe?g|png|webp|gif)$/i.test(f));
  if (hit) return join(outDir, hit);
  throw new Error(
    `배경 소스가 없습니다.\n` +
      `- 영상: --video <경로> 또는 ${outDir}/videos/*.mp4 (1단계 --download)\n` +
      `- 이미지: --image <경로> 또는 ${outDir}/input.*`,
  );
}

/** 영상에서 장면 이해용 키프레임 N장 추출(대본 생성 비전 입력) */
async function extractKeyframes(video, outDir, n = 5) {
  const dir = join(outDir, ".frames");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const dur = await probeDuration(video);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = (dur * (i + 0.5)) / n;
    const f = join(dir, `k${i}.jpg`);
    await exec(FFMPEG, ["-y", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", "scale=512:-1", f]);
    frames.push(f);
  }
  return frames;
}

/** 반환: { kind:'video'|'image', file:refs폴더내파일명, frames:[비전용 이미지경로들] } */
async function prepareBackground(outDir) {
  if (IMAGE) {
    const img = await findImage(outDir);
    return { kind: "image", file: basename(img), frames: [img] };
  }
  // 영상 소스 결정: --video → refs/<키워드>/videos/ 첫 파일
  let video = VIDEO;
  if (!video) {
    const vids = (await readdir(join(outDir, "videos")).catch(() => [])).filter((f) => VIDEO_EXT.test(f)).sort();
    if (vids[0]) video = join(outDir, "videos", vids[0]);
  }
  if (video) {
    if (!existsSync(video)) throw new Error(`영상을 찾을 수 없음: ${video}`);
    const frames = await extractKeyframes(video, outDir, 5);
    return { kind: "video", raw: video, frames };
  }
  // 폴백: 이미지
  const img = await findImage(outDir);
  return { kind: "image", file: basename(img), frames: [img] };
}

/** 배경 영상을 내레이션 길이에 맞춰 loop+trim, 9:16 크롭, 무음 처리 → source.mp4 */
async function finalizeVideo(raw, outDir, durationSec) {
  const dest = join(outDir, "source.mp4");
  await exec(FFMPEG, [
    "-y", "-stream_loop", "-1", "-i", raw,
    "-t", durationSec.toFixed(3),
    "-an", // 원본 오디오 제거(내레이션만 사용)
    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    "-r", String(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", dest,
  ]);
  return basename(dest);
}

// ---------- 1) 대본 생성 (Claude) ----------
const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "scenes", "cta", "hashtags"],
  properties: {
    title: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["narration", "caption"],
        properties: {
          narration: { type: "string" },
          caption: { type: "string" },
        },
      },
    },
    cta: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
};

/** 응답 텍스트에서 JSON 객체 추출(코드펜스/앞뒤 잡소리 제거) */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  const body = s >= 0 && e > s ? raw.slice(s, e + 1) : raw;
  return JSON.parse(body);
}

async function loadReferenceTitles(outDir) {
  try {
    const idx = JSON.parse(await readFile(join(outDir, "index.json"), "utf8"));
    return (idx.notes || [])
      .map((n) => (n.title || "").trim())
      .filter(Boolean)
      .slice(0, 15);
  } catch {
    return [];
  }
}

async function genScript(outDir, frames, kind) {
  const titles = await loadReferenceTitles(outDir);
  const refBlock = titles.length
    ? `참고할 실제 인기 영상 제목(샤오홍수 "${KEYWORD}" 검색):\n- ${titles.join("\n- ")}`
    : "(레퍼런스 제목 없음)";

  const isVideo = kind === "video";
  const prompt = [
    `너는 한국 유튜브 쇼핑 쇼츠 카피라이터다.`,
    isVideo
      ? `아래는 상품 데모 영상에서 시간 순서대로 뽑은 장면 프레임들이다. 이 영상 위에 얹을 한국어 내레이션+자막 대본을 만들어라.`
      : `아래 상품 이미지를 보고 세로 쇼츠용 한국어 대본을 만들어라.`,
    `완성 영상은 15~25초 세로 쇼츠다.`,
    ``,
    `상품 키워드: ${KEYWORD}`,
    refBlock,
    ``,
    `요구사항:`,
    isVideo
      ? `- scenes 는 프레임 순서(장면 흐름)에 맞춰 4~6개. 각 scene 의 narration 은 그 장면에서 벌어지는 일을 설명·판매하듯 이어져야 한다.`
      : `- scenes 는 4~6개.`,
    `- 각 scene 은 narration(내레이션 한 문장, 자연스러운 구어체)과 caption(화면 자막, 아주 짧게 12자 내외, 핵심 한 줄)로 구성.`,
    `- 첫 scene 은 강한 후킹(질문/공감/충격). 마지막 scene 은 구매 욕구 자극.`,
    `- title 은 18자 이내 후킹 제목. cta 는 14자 이내 행동유도(예: "링크는 댓글에").`,
    `- 숫자·"무료/최저가/한정" 같은 세일즈 키워드를 자연스럽게(과장/허위 금지).`,
    `- hashtags 는 5개(# 없이 단어만). 반드시 한국어로.`,
  ].join("\n");

  const imageBlocks = await Promise.all(
    frames.map(async (p) => ({
      type: "image",
      source: { type: "base64", media_type: mediaType(p), data: (await readFile(p)).toString("base64") },
    })),
  );

  const client = new Anthropic(); // 키는 env(ANTHROPIC_API_KEY) 또는 ant 프로필에서 자동 해석
  const content = [
    ...imageBlocks,
    { type: "text", text: prompt + "\n\n결과는 JSON 객체만 출력하라(설명·코드펜스 없이)." },
  ];
  const base = { model: MODEL, max_tokens: 2048, messages: [{ role: "user", content }] };

  let resp;
  try {
    // 우선 구조화 출력(스키마 강제) 시도
    resp = await client.messages.create({
      ...base,
      output_config: { format: { type: "json_schema", schema: SCRIPT_SCHEMA } },
    });
  } catch (e) {
    if (e?.status === 401 || /api[_ ]?key|authentication/i.test(e?.message || "")) {
      throw new Error(
        "Claude 인증 실패 — .env.local 에 ANTHROPIC_API_KEY 를 넣거나 `ant auth login` 하세요.\n" +
          "(대본을 직접 쓰려면 script.json 을 만들고 --skip-script 로 실행)",
      );
    }
    // output_config 미지원(구버전 SDK/모델) 등 → 스키마 없이 재시도
    console.warn("⚠️ 구조화 출력 실패, 일반 모드로 재시도:", e?.message || e);
    resp = await client.messages.create(base);
  }

  const textBlock = resp.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("대본 응답이 비었습니다.");
  const script = extractJson(textBlock.text);
  await writeFile(join(outDir, "script.json"), JSON.stringify(script, null, 2));
  console.log(`📝 대본 생성: ${join(outDir, "script.json")} (scene ${script.scenes.length}개)`);
  return script;
}

// ---------- 2) 내레이션(TTS) ----------
async function buildNarration(outDir, script) {
  // 사용자가 직접 만든 내레이션 오디오가 있으면 TTS 를 건너뛰고 그대로 사용한다.
  // 자막은 각 장면 내레이션 글자 수 비율로 오디오 전체 길이에 나눠 대략 싱크를 맞춘다.
  if (AUDIO) {
    if (!existsSync(AUDIO)) throw new Error(`오디오를 찾을 수 없음: ${AUDIO}`);
    const narration = join(outDir, "narration.mp3");
    await exec(FFMPEG, [
      "-y", "-i", AUDIO,
      "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "2", narration,
    ]);
    const total = await probeDuration(narration);
    const weights = script.scenes.map((s) => Math.max(1, (s.narration || "").trim().length));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const timings = [];
    let cursor = 0;
    for (let i = 0; i < script.scenes.length; i++) {
      const dur = (total * weights[i]) / sum;
      timings.push({ start: cursor, end: cursor + dur, caption: script.scenes[i].caption });
      cursor += dur;
    }
    console.log(`🎙  직접 만든 내레이션 사용: ${narration} (${total.toFixed(1)}s, TTS 건너뜀)`);
    return { narration, timings, durationSec: total };
  }

  const ttsDir = join(outDir, ".tts");
  await rm(ttsDir, { recursive: true, force: true });
  await mkdir(ttsDir, { recursive: true });

  // 장면 사이 간격용 무음
  const silence = join(ttsDir, "silence.wav");
  await exec(FFMPEG, ["-y", "-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono`, "-t", String(GAP), silence]);

  // TTS 제공자 결정
  const useQwen = TTS === "qwen" || (TTS !== "say" && qwenConfigured());
  let qwenOpts = null;
  if (useQwen) {
    if (!qwenConfigured())
      throw new Error("Qwen TTS 미설정 — .env.local 에 DASHSCOPE_API_KEY, DASHSCOPE_WORKSPACE_ID 필요");
    const cloned = await loadClonedVoice();
    qwenOpts = cloned
      ? { model: cloned.targetModel, voice: cloned.voiceId }
      : { model: FLASH_MODEL, voice: QWEN_VOICE };
    console.log(`🎙  TTS: Qwen3-TTS (${cloned ? "클론:" + cloned.name : "내장:" + QWEN_VOICE})`);
  } else {
    console.log(`🎙  TTS: macOS say (${VOICE})`);
  }

  const listLines = [];
  const timings = [];
  let cursor = 0;
  for (let i = 0; i < script.scenes.length; i++) {
    const text = script.scenes[i].narration;
    const wav = join(ttsDir, `s${i}.wav`);
    if (useQwen) {
      const raw = join(ttsDir, `s${i}.audio`);
      await qwenSynthesize(text, qwenOpts, raw);
      await exec(FFMPEG, ["-y", "-i", raw, "-ar", "44100", "-ac", "1", wav]);
    } else {
      const aiff = join(ttsDir, `s${i}.aiff`);
      await exec(SAY, ["-v", VOICE, "-o", aiff, text]);
      await exec(FFMPEG, ["-y", "-i", aiff, "-ar", "44100", "-ac", "1", wav]);
    }
    const dur = await probeDuration(wav);
    timings.push({ start: cursor, end: cursor + dur + GAP, caption: script.scenes[i].caption });
    cursor += dur + GAP;
    listLines.push(`file '${wav}'`);
    listLines.push(`file '${silence}'`);
  }

  const listFile = join(ttsDir, "list.txt");
  await writeFile(listFile, listLines.join("\n"));
  const narration = join(outDir, "narration.mp3");
  await exec(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-q:a", "2", narration]);

  const durationSec = cursor + TAIL;
  console.log(`🎙  내레이션 완성: ${narration} (${durationSec.toFixed(1)}s)`);
  return { narration, timings, durationSec };
}

// ---------- 3) 렌더 ----------
async function render(outDir, short) {
  await copyFile(resolve(ROOT, "remotion/assets/DoHyeon.ttf"), join(outDir, "DoHyeon.ttf")).catch(() =>
    console.warn("⚠️ DoHyeon.ttf 복사 실패 — 폴백 폰트"),
  );
  await writeFile(join(outDir, "short.json"), JSON.stringify(short, null, 2));

  console.log("📦 Remotion 번들링…");
  const serveUrl = await bundle({
    entryPoint: resolve(ROOT, "remotion/index.ts"),
    publicDir: outDir, // staticFile(input.*, narration.mp3, DoHyeon.ttf) 해결
    onProgress: (p) => process.stdout.write(`\r  번들 ${p}%`),
  });
  process.stdout.write("\n");

  const inputProps = { short };
  const composition = await selectComposition({
    serveUrl,
    id: "ShoppingShort",
    inputProps,
    browserExecutable: CHROME,
  });

  const out = join(outDir, "short.mp4");
  console.log(`🎬 렌더: ${composition.width}x${composition.height} · ${composition.durationInFrames}f @ ${composition.fps}fps`);
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: out,
    inputProps,
    browserExecutable: CHROME,
    concurrency: Math.max(1, parseInt(process.env.RENDER_CONCURRENCY || "1", 10)),
    chromiumOptions: { ignoreCertificateErrors: true, headless: true },
    onProgress: ({ progress }) => process.stdout.write(`\r  렌더 ${Math.round(progress * 100)}%`),
  });
  process.stdout.write("\n");
  console.log(`✅ 완료: ${out}`);
  return out;
}

// ---------- 메인 ----------
async function main() {
  if (!KEYWORD) throw new Error('키워드가 필요합니다. 예) node shopping/make-short.mjs --keyword "电风扇"');
  const outDir = join(REFS_DIR, slug(KEYWORD));
  await mkdir(outDir, { recursive: true });

  const bg = await prepareBackground(outDir);
  console.log(`🎞  배경 소스: ${bg.kind} = ${bg.kind === "video" ? bg.raw : bg.file}`);

  // 1) 대본
  let script;
  const scriptPath = join(outDir, "script.json");
  if (SKIP_SCRIPT && existsSync(scriptPath)) {
    script = JSON.parse(await readFile(scriptPath, "utf8"));
    console.log(`📝 기존 대본 재사용: ${scriptPath}`);
  } else {
    script = await genScript(outDir, bg.frames, bg.kind);
  }
  if (DRY_SCRIPT) {
    console.log("🅿️ [dry-script] 대본만 생성하고 종료.");
    return;
  }

  // 2) 내레이션
  const { narration, timings, durationSec } = await buildNarration(outDir, script);

  // 3) 배경 소스 확정(영상은 내레이션 길이에 맞춰 가공) + short.json + 렌더
  let videoFile = null;
  let imageFile = null;
  if (bg.kind === "video") {
    console.log("🎞  배경 영상 가공(loop/crop/무음)…");
    videoFile = await finalizeVideo(bg.raw, outDir, durationSec);
  } else {
    imageFile = bg.file;
  }
  const durationFrames = Math.ceil(durationSec * FPS);
  const short = {
    fps: FPS,
    width: 1080,
    height: 1920,
    durationSec,
    durationFrames,
    video: videoFile,
    image: imageFile,
    audio: basename(narration),
    bgm: null,
    title: script.title,
    cta: script.cta,
    hashtags: script.hashtags || [],
    scenes: timings,
  };
  await render(outDir, short);
}

main().catch((e) => {
  console.error(`\n❌ ${e.stack || e.message}`);
  process.exit(1);
});
