#!/usr/bin/env node
/**
 * 대본(script.md) → 씬 분해 + macOS say 내레이션 + 문장별 타이밍 → episode.json
 *
 * 사용:  node pipeline/build-episode.mjs <episodeDir> [--voice Yuna] [--rate 180]
 * 산출:  <episodeDir>/narration.mp3, <episodeDir>/episode.json
 *
 * say 는 단어 타임스탬프를 주지 않으므로, 문장별로 따로 합성해 각 길이(ffprobe)를
 * 측정하고 이어붙여 정확한 자막/씬 타이밍을 만든다.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);
const SAY = process.env.SAY_BIN || "/usr/bin/say";
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "/opt/homebrew/bin/ffprobe";

const FPS = 30;
const W = 1920;
const H = 1080;
const GAP = 0.28; // 문장 사이 간격(초)
const INTRO_SECONDS = 90; // 앞부분 "영상형"(졸라맨 애니) 구간 길이 기준

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("사용법: node pipeline/build-episode.mjs <episodeDir> [--voice Yuna] [--rate 180]");
  process.exit(1);
}
const voice = argVal("--voice") || "Yuna";
const rate = argVal("--rate") || "180";
function argVal(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

/** 대본 마크다운에서 "## 📝 대본" 섹션만 추출 */
function extractScriptSection(md) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^##\s.*대본/.test(l.trim()));
  if (start < 0) return md;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/** 괄호/대괄호 연출 지시문 추출 (포즈·비주얼 힌트로 사용) */
function directionsOf(text) {
  const out = [];
  for (const m of text.matchAll(/[([（【]([^)\]）】]*)[)\]）】]/g)) out.push(m[1].trim());
  return out;
}

/** 내레이션만 남기기 — 괄호 지시·마크다운·타임코드·따옴표·라벨 제거 */
function toNarration(text) {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[([（【][^)\]）】]*[)\]）】]/g, " ")
    .replace(/\d{1,2}:\d{2}\s*[~\-–—]\s*\d{1,2}:\d{2}/g, " ")
    .replace(/[*_`>#]/g, " ")
    .replace(/[""''「」『』]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 문장 단위 분할 (한국어 종결 + 감탄/물음표) */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?。…])\s+|(?<=[다요죠][.!?]?)\s+(?=[A-Z가-힣])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/** 연출 힌트 → 졸라맨 포즈 */
function poseFrom(hints, narration) {
  const t = (hints.join(" ") + " " + narration).toLowerCase();
  if (/가리|포인트|간판|이거|여기|보세요/.test(t)) return "point";
  if (/놀|충격|헉|뭐|어떻게|\?!|!\?/.test(t)) return "shocked";
  if (/생각|궁금|왜|글쎄|음…|고민/.test(t)) return "think";
  if (/으쓱|글쎄요|모르|애매/.test(t)) return "shrug";
  if (/기쁨|행복|좋|웃|신난|야호/.test(t)) return "happy";
  if (/고통|스트레스|슬프|낙담|아까|손해|깨졌/.test(t)) return "sad";
  return "idle";
}

async function sayDuration(text, outWav, tmp) {
  const aiff = join(tmp, "s.aiff");
  await exec(SAY, ["-v", voice, "-r", rate, "-o", aiff, text], {
    maxBuffer: 1024 * 1024 * 32,
  });
  // wav 16k 모노로 정규화(이어붙이기 안정)
  await exec(FFMPEG, ["-y", "-i", aiff, "-ar", "44100", "-ac", "1", outWav], {
    maxBuffer: 1024 * 1024 * 32,
  });
  const { stdout } = await exec(FFPROBE, [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outWav,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

async function main() {
  const md = await readFile(join(dir, "script.md"), "utf8");
  const section = extractScriptSection(md);

  // 섹션(### 소제목) 단위로 씬을 나눈다
  const blocks = [];
  let cur = { title: "오프닝", raw: "" };
  for (const line of section.split("\n")) {
    const h = line.match(/^###\s+(.*)/);
    if (h) {
      if (cur.raw.trim()) blocks.push(cur);
      cur = { title: h[1].replace(/[#*]/g, "").trim(), raw: "" };
    } else {
      cur.raw += line + "\n";
    }
  }
  if (cur.raw.trim()) blocks.push(cur);

  const tmp = await mkdtemp(join(tmpdir(), "epi-"));
  const partFiles = [];
  const scenes = [];
  let t = 0;
  let idx = 0;

  try {
    for (const b of blocks) {
      const hints = directionsOf(b.raw);
      const narration = toNarration(b.raw);
      const sentences = splitSentences(narration);
      if (!sentences.length) continue;

      const sceneLines = [];
      for (const s of sentences) {
        const wav = join(tmp, `p${idx}.wav`);
        const dur = await sayDuration(s, wav, tmp);
        partFiles.push(wav);
        sceneLines.push({ text: s, start: +t.toFixed(3), end: +(t + dur).toFixed(3) });
        t += dur + GAP;
        idx++;
        process.stdout.write(`\r  합성 ${idx}문장 · ${t.toFixed(1)}s`);
      }
      scenes.push({
        title: b.title,
        pose: poseFrom(hints, narration),
        hints,
        start: sceneLines[0].start,
        end: sceneLines[sceneLines.length - 1].end,
        lines: sceneLines,
      });
    }
    process.stdout.write("\n");

    // 모든 문장 wav 를 GAP 무음과 함께 이어붙여 narration.mp3 생성
    const listFile = join(tmp, "list.txt");
    const silence = join(tmp, "gap.wav");
    await exec(FFMPEG, [
      "-y", "-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono`, "-t", String(GAP), silence,
    ]);
    const concatLines = [];
    for (const f of partFiles) {
      concatLines.push(`file '${f}'`);
      concatLines.push(`file '${silence}'`);
    }
    await writeFile(listFile, concatLines.join("\n"), "utf8");
    const mp3 = join(dir, "narration.mp3");
    await exec(FFMPEG, [
      "-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-codec:a", "libmp3lame", "-q:a", "3", mp3,
    ], { maxBuffer: 1024 * 1024 * 64 });

    const total = +t.toFixed(3);
    // 앞 INTRO_SECONDS 안에 시작하는 씬은 인트로(영상형), 나머지는 개념(이미지+켄번스)
    scenes.forEach((s, i) => {
      s.kind = i === 0 || s.start < INTRO_SECONDS ? "intro" : "concept";
    });

    const episode = {
      fps: FPS,
      width: W,
      height: H,
      voice,
      durationSec: total,
      durationFrames: Math.ceil(total * FPS) + FPS, // 끝 여유 1초
      audio: "narration.mp3",
      scenes,
    };
    await writeFile(join(dir, "episode.json"), JSON.stringify(episode, null, 2), "utf8");
    console.log(`✅ episode.json (${scenes.length}씬 · ${total.toFixed(1)}초) · narration.mp3`);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error("\n❌ 실패:", e.message);
  process.exit(1);
});
