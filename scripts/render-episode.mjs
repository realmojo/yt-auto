#!/usr/bin/env node
/**
 * episode.json → Remotion 으로 mp4 렌더.
 * 사용:  node scripts/render-episode.mjs <episodeDir> [--out final.mp4]
 * 시스템 Chrome 을 사용해 chrome-headless-shell 다운로드(프록시 이슈)를 피한다.
 */
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { readFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("사용법: node scripts/render-episode.mjs <episodeDir> [--out final.mp4]");
  process.exit(1);
}
const outName = (() => {
  const i = args.indexOf("--out");
  return i >= 0 ? args[i + 1] : "final.mp4";
})();

const CHROME =
  process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const episodeDir = resolve(dir);
  const episode = JSON.parse(await readFile(join(episodeDir, "episode.json"), "utf8"));
  const out = join(episodeDir, outName);

  // Do Hyeon 폰트를 publicDir(=episodeDir)로 복사 → staticFile('DoHyeon.ttf') 해결
  await copyFile(resolve("remotion/assets/DoHyeon.ttf"), join(episodeDir, "DoHyeon.ttf")).catch(
    () => console.warn("⚠️ DoHyeon.ttf 복사 실패 — 폴백 폰트 사용"),
  );

  console.log("📦 Remotion 번들링…");
  const serveUrl = await bundle({
    entryPoint: resolve("remotion/index.ts"),
    // 에피소드 폴더를 public 으로 → staticFile('narration.mp3') 해결
    publicDir: episodeDir,
    onProgress: (p) => process.stdout.write(`\r  번들 ${p}%`),
  });
  process.stdout.write("\n");

  const inputProps = { episode };
  const composition = await selectComposition({
    serveUrl,
    id: "Episode",
    inputProps,
    browserExecutable: CHROME,
  });

  // --frames N : 앞 N프레임만 렌더(빠른 검증용)
  const fi = args.indexOf("--frames");
  const frameRange =
    fi >= 0 ? [0, Math.max(0, parseInt(args[fi + 1], 10) - 1)] : undefined;

  console.log(
    `🎬 렌더: ${composition.width}x${composition.height} · ${frameRange ? frameRange[1] + 1 : composition.durationInFrames}f @ ${composition.fps}fps`,
  );
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: out,
    inputProps,
    browserExecutable: CHROME,
    frameRange,
    // 이 환경의 시스템 Chrome 은 로컬 서버에 다중 탭 접속 시 간헐 실패 → 동시성 보수적으로(기본 1).
    // 안정적이면 RENDER_CONCURRENCY 로 올릴 수 있음.
    concurrency: Math.max(1, parseInt(process.env.RENDER_CONCURRENCY || "1", 10)),
    logLevel: process.env.RV ? "verbose" : "info",
    chromiumOptions: { ignoreCertificateErrors: true, headless: true },
    onProgress: ({ progress }) =>
      process.stdout.write(`\r  렌더 ${Math.round(progress * 100)}%`),
  });
  process.stdout.write("\n");
  console.log(`✅ 완료: ${out}`);
}

main().catch((e) => {
  console.error("\n❌ 렌더 실패:", e.stack || e.message);
  process.exit(1);
});
