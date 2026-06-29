#!/usr/bin/env node
/** episode.json 의 특정 프레임들을 PNG 로 렌더(빠른 룩 검증). 사용: node scripts/preview-frames.mjs <dir> f1 f2 ... */
import { bundle } from "@remotion/bundler";
import { selectComposition, renderStill } from "@remotion/renderer";
import { readFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const dir = args[0];
const frames = args.slice(1).map(Number).filter((n) => !Number.isNaN(n));
const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const episodeDir = resolve(dir);
const episode = JSON.parse(await readFile(join(episodeDir, "episode.json"), "utf8"));
await copyFile(resolve("remotion/assets/DoHyeon.ttf"), join(episodeDir, "DoHyeon.ttf")).catch(() => {});
const serveUrl = await bundle({ entryPoint: resolve("remotion/index.ts"), publicDir: episodeDir });
const inputProps = { episode };
const composition = await selectComposition({ serveUrl, id: "Episode", inputProps, browserExecutable: CHROME });
for (const f of frames) {
  const out = join("/tmp", `prev_${f}.png`);
  await renderStill({
    composition,
    serveUrl,
    output: out,
    frame: f,
    inputProps,
    browserExecutable: CHROME,
    chromiumOptions: { ignoreCertificateErrors: true, headless: true },
  });
  console.log("✅", out);
}
