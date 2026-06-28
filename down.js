#!/usr/bin/env node
/**
 * 유튜브 채널의 숏츠(또는 동영상)를 일괄 다운로드한다.
 * - QuickTime·모든 플레이어 호환을 위해 H.264(avc1) + AAC mp4 로 받는다 (AV1/VP9 회피).
 * - download-archive 로 중복 없이 이어받는다(나중에 다시 실행하면 새 영상만).
 * - 내부적으로 yt-dlp + ffmpeg 를 사용한다. (설치: brew install yt-dlp ffmpeg)
 *
 * 사용법:
 *   node down.js                          # 기본: @daissueee 채널 숏츠
 *   node down.js @채널핸들                 # 해당 채널 숏츠
 *   node down.js "https://youtube.com/@x/shorts"   # 전체 URL 직접 지정
 *   node down.js @채널핸들 ~/Movies/x      # 저장 폴더 지정
 *   node down.js @채널핸들 --videos        # 숏츠 대신 일반 동영상 탭
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));

const target = positional[0] || "@daissueee";
const tab = flags.has("--videos") ? "videos" : "shorts";

/** 입력(@핸들 / 핸들 / URL)을 채널 탭 URL 로 정규화 */
function toUrl(input) {
  if (/^https?:\/\//i.test(input)) return input;
  const handle = input.startsWith("@") ? input : `@${input}`;
  return `https://www.youtube.com/${handle}/${tab}`;
}

/** 저장 폴더 이름에 쓸 채널명 추출 */
function channelName(input) {
  const m = input.match(/@([\w.-]+)/);
  return m ? m[1] : "youtube";
}

const url = toUrl(target);
const outDir =
  positional[1] || join(homedir(), "Downloads", `${channelName(target)}_${tab}`);
mkdirSync(outDir, { recursive: true });

const ytdlpArgs = [
  // 비디오는 H.264(avc1), 오디오는 AAC(mp4a) 우선 → QuickTime 등 모든 곳에서 열림
  "-f",
  "bv*[vcodec^=avc1]+ba[acodec^=mp4a]/bv*+ba/b",
  "-S",
  "vcodec:h264,res,fps",
  "--merge-output-format",
  "mp4",
  "-o",
  join(outDir, "%(upload_date)s_%(title).80B [%(id)s].%(ext)s"),
  "--download-archive",
  join(outDir, "archive.txt"),
  "-i", // 일부 영상 실패해도 계속 진행
  "--sleep-interval",
  "2",
  "--max-sleep-interval",
  "5",
  ...(flags.has("--cookies") ? ["--cookies-from-browser", "chrome"] : []),
  url,
];

console.log(`▶ 대상   : ${url}`);
console.log(`▶ 저장   : ${outDir}`);
console.log(`▶ 코덱   : H.264 + AAC (mp4)`);
console.log(`▶ 이어받기: ${join(outDir, "archive.txt")}\n`);

const child = spawn("yt-dlp", ytdlpArgs, { stdio: "inherit" });

child.on("error", (e) => {
  if (e.code === "ENOENT") {
    console.error(
      "\n✖ yt-dlp 가 설치되어 있지 않습니다.\n  설치: brew install yt-dlp ffmpeg",
    );
  } else {
    console.error("\n✖ 실행 오류:", e.message);
  }
  process.exit(1);
});

child.on("close", (code) => {
  if (code === 0) console.log("\n✔ 다운로드 완료");
  else console.log(`\n종료 코드 ${code} (실패한 영상은 -i 로 건너뜀)`);
  process.exit(code ?? 0);
});
