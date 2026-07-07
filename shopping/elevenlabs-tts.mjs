/**
 * ElevenLabs TTS — 한국어 내레이션 합성.
 * env: ELEVENLABS_API_KEY(필수), ELEVENLABS_VOICE_ID(필수), ELEVENLABS_MODEL(선택).
 * 인터페이스는 qwen-tts.mjs 와 동일(elevenConfigured / synthesize).
 * 한국어는 eleven_multilingual_v2 가 안정적.
 */
import { writeFile } from "node:fs/promises";

const BASE = "https://api.elevenlabs.io/v1";
export const EL_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
export const EL_VOICE = process.env.ELEVENLABS_VOICE_ID || "";

export function elevenConfigured() {
  return !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVENLABS_VOICE_ID;
}

/** text → outPath(mp3). opts: { voice?, model?, stability?, similarity? } */
export async function synthesize(text, opts, outPath) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY 가 없습니다(.env.local).");
  const voice = (opts && opts.voice) || process.env.ELEVENLABS_VOICE_ID;
  const model = (opts && opts.model) || EL_MODEL;
  if (!voice) throw new Error("ELEVENLABS_VOICE_ID 가 없습니다(.env.local).");

  const res = await fetch(`${BASE}/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: opts?.stability ?? 0.5,
        similarity_boost: opts?.similarity ?? 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${t.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
  return outPath;
}
