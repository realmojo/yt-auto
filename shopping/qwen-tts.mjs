/**
 * Qwen3-TTS (DashScope / Alibaba Cloud Model Studio) — 한국어 고품질 내레이션 + 보이스 클로닝.
 *
 * 필요 env (.env.local 또는 환경변수):
 *   DASHSCOPE_API_KEY       — Model Studio API 키
 *   DASHSCOPE_WORKSPACE_ID  — 워크스페이스 ID(엔드포인트 서브도메인)
 *   DASHSCOPE_REGION        — 기본 ap-southeast-1(싱가포르, 국제판)
 *
 * CLI:
 *   보이스 클론 등록:  node shopping/qwen-tts.mjs --enroll ~/voice.mp3 --name myvoice
 *     → voice_id 를 shopping/qwen-voice.json 에 저장(이후 자동 사용)
 *   합성 테스트:       node shopping/qwen-tts.mjs --say "안녕하세요" --out /tmp/o.wav
 *
 * 참조 오디오 권장: 10~20초(최대 60초), 모노, 24kHz↑, WAV(16bit)/MP3/M4A, <10MB, 또렷한 발화.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const VOICE_STORE = resolve(__dirname, "qwen-voice.json");

// .env.local 로드(스탠드얼론 실행 대비; 이미 로드됐으면 덮어쓰지 않음)
try {
  const env = await readFile(resolve(ROOT, ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* 없으면 무시 */
}

const KEY = () => process.env.DASHSCOPE_API_KEY;
const WS = () => process.env.DASHSCOPE_WORKSPACE_ID;
const REGION = () => process.env.DASHSCOPE_REGION || "ap-southeast-1";
export const VC_MODEL = process.env.QWEN_VC_MODEL || "qwen3-tts-vc-2026-01-22";
export const FLASH_MODEL = process.env.QWEN_TTS_MODEL || "qwen3-tts-flash";

export function qwenConfigured() {
  return !!(KEY() && WS());
}

function base() {
  if (!KEY()) throw new Error("DASHSCOPE_API_KEY 미설정");
  if (!WS()) throw new Error("DASHSCOPE_WORKSPACE_ID 미설정");
  return `https://${WS()}.${REGION()}.maas.aliyuncs.com/api/v1/services`;
}

function mimeOf(p) {
  const e = extname(p).toLowerCase();
  if (e === ".wav") return "audio/wav";
  if (e === ".m4a") return "audio/x-m4a";
  return "audio/mpeg";
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`DashScope ${res.status}: ${(json.message || json.raw || text).slice(0, 400)}`);
  }
  return json;
}

/** 참조 오디오로 보이스 등록 → voice_id 반환(+ qwen-voice.json 저장) */
export async function enrollVoice(audioPath, name = "myvoice", targetModel = VC_MODEL) {
  const b64 = (await readFile(audioPath)).toString("base64");
  const json = await postJson(`${base()}/audio/tts/customization`, {
    model: "qwen-voice-enrollment",
    input: {
      action: "create",
      target_model: targetModel,
      preferred_name: name,
      audio: { data: `data:${mimeOf(audioPath)};base64,${b64}` },
    },
  });
  // 응답 필드가 문서에 명확치 않아 방어적으로 탐색
  const o = json.output || json;
  const voiceId = o.voice_id || o.voice || o.voice_name || o.id;
  if (!voiceId) throw new Error(`voice_id 응답 못 찾음: ${JSON.stringify(json).slice(0, 400)}`);
  await writeFile(
    VOICE_STORE,
    JSON.stringify({ voiceId, name, targetModel, at: new Date().toISOString() }, null, 2),
  );
  return voiceId;
}

/** 저장된 클론 voice 정보(없으면 null) */
export async function loadClonedVoice() {
  if (!existsSync(VOICE_STORE)) return null;
  try {
    return JSON.parse(await readFile(VOICE_STORE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 텍스트 → 오디오 파일 다운로드.
 * opts: { voice, model, languageType='Korean' }
 *  - 클론 음성: model=VC_MODEL, voice=voiceId
 *  - 내장 음성: model=FLASH_MODEL, voice=내장명(예: "Cherry")
 */
export async function synthesize(text, opts, outPath) {
  const model = opts.model || FLASH_MODEL;
  const json = await postJson(`${base()}/aigc/multimodal-generation/generation`, {
    model,
    input: { text, voice: opts.voice, language_type: opts.languageType || "Korean" },
  });
  const url = json.output?.audio?.url || json.output?.url || json.audio?.url;
  if (!url) throw new Error(`오디오 URL 응답 못 찾음: ${JSON.stringify(json).slice(0, 400)}`);
  const audio = await fetch(url);
  if (!audio.ok) throw new Error(`오디오 다운로드 실패 HTTP ${audio.status}`);
  await writeFile(outPath, Buffer.from(await audio.arrayBuffer()));
  return outPath;
}

// ---------- CLI ----------
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const arg = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
  };
  (async () => {
    try {
      if (argv.includes("--enroll")) {
        const audio = arg("enroll");
        if (!audio) throw new Error("사용: --enroll <오디오파일> [--name 이름]");
        const id = await enrollVoice(audio, arg("name", "myvoice"));
        console.log(`✅ 보이스 등록 완료 → voice_id: ${id}\n   저장: ${VOICE_STORE}`);
      } else if (argv.includes("--say")) {
        const text = arg("say", "안녕하세요, 테스트입니다.");
        const cloned = await loadClonedVoice();
        const opts = cloned
          ? { model: cloned.targetModel, voice: cloned.voiceId }
          : { model: FLASH_MODEL, voice: arg("voice", "Cherry") };
        const out = arg("out", "/tmp/qwen_tts.wav");
        await synthesize(text, opts, out);
        console.log(`✅ 합성 완료 → ${out} (${cloned ? "클론:" + cloned.name : "내장:" + opts.voice})`);
      } else {
        console.log("사용: --enroll <audio> [--name X]  |  --say \"텍스트\" [--voice X] [--out f.wav]");
      }
    } catch (e) {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    }
  })();
}
