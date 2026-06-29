#!/usr/bin/env node
/**
 * output 폴더의 영상을 유튜브에 "1일 1영상, 매일 오후 6시(KST) 공개"로 예약 업로드.
 *
 * 동작 방식
 *  - 각 영상을 private 로 업로드하면서 publishAt(예약 공개 시각)을 지정한다.
 *    → 업로드 직후엔 비공개, 지정 시각이 되면 유튜브가 자동으로 공개로 전환.
 *  - 파일명 순으로 정렬해 가장 오래된 영상부터 하루 간격으로 배정.
 *  - 이미 올린 파일은 상태파일(output/.yt-upload-state.json)에 기록해 건너뜀(이어하기).
 *
 * 사전 준비 (최초 1회)
 *  1) Google Cloud Console → API/서비스 → "YouTube Data API v3" 사용 설정
 *  2) OAuth 동의 화면 구성(테스트 사용자에 본인 계정 추가)
 *  3) 사용자 인증 정보 → OAuth 클라이언트 ID → "데스크톱 앱" 생성 후 JSON 다운로드
 *     → scripts/client_secret.json 로 저장 (또는 --secret 로 경로 지정)
 *  최초 실행 시 브라우저가 열리며 로그인/동의하면 토큰이 캐시됨(scripts/.youtube-token.json).
 *
 * 사용
 *  node scripts/youtube-upload.mjs                 # output 폴더, 내일부터 매일 18:00 예약
 *  node scripts/youtube-upload.mjs --start=2026-07-01 --time=18:00
 *  node scripts/youtube-upload.mjs --dir=output --dry-run   # 실제 업로드 없이 일정만 출력
 *  node scripts/youtube-upload.mjs --privacy=private        # 예약 없이 그냥 비공개 업로드
 *
 * 참고: 업로드 1건당 API 할당량 1600 units 소비(기본 일일 10,000) → 하루 최대 약 6건.
 */
import { google } from "googleapis";
import http from "node:http";
import { URL } from "node:url";
import { exec as execCb } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, writeFile, readdir, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------- 인자 파싱 ----------
const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
};

const DIR = resolve(ROOT, flag("dir", "output"));
const TIME = String(flag("time", "18:00")); // KST 기준 공개 시각 HH:mm
const TZ_OFFSET = "+09:00"; // Asia/Seoul
const DRY = !!flag("dry-run", false);
const DELETE_AFTER = !!flag("delete", false); // 업로드 성공 시 원본 파일 삭제
const PRIVACY = flag("privacy", null); // 지정 시 예약 없이 해당 공개상태로 업로드
const SECRET_PATH = resolve(ROOT, flag("secret", "scripts/client_secret.json"));
const TOKEN_PATH = resolve(ROOT, "scripts/.youtube-token.json");
const STATE_PATH = join(DIR, ".yt-upload-state.json");
const CATEGORY_ID = String(flag("category", "24")); // 24 = Entertainment
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v"]);
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

// ---------- 날짜 유틸 ----------
function todayKstYmd() {
  // 현재 시각을 KST 벽시계로 환산한 뒤 날짜만 추출
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}
function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
// "YYYY-MM-DD" + "HH:mm" (KST) → UTC ISO(Z) 문자열
function publishAtIso(ymd, time) {
  return new Date(`${ymd}T${time}:00${TZ_OFFSET}`).toISOString();
}

// ---------- 파일명 → 제목 ----------
function titleFromFilename(path) {
  let t = basename(path, extname(path))
    .replace(/^\d{6,8}[_-]/, "") // 앞 날짜 프리픽스 제거
    .replace(/\s*\[[^\]]+\]\s*/g, " ") // [영상ID] 제거
    .replace(/-?해숏티$/, "") // 접미사 제거
    .trim();
  if (!t) t = basename(path, extname(path));
  return t;
}

// ---------- OAuth ----------
async function getAuth() {
  if (!existsSync(SECRET_PATH)) {
    console.error(`OAuth 클라이언트 파일이 없습니다: ${SECRET_PATH}`);
    console.error(
      "Google Cloud Console에서 '데스크톱 앱' OAuth 클라이언트를 만들어 해당 경로에 저장하세요.",
    );
    process.exit(1);
  }
  const raw = JSON.parse(await readFile(SECRET_PATH, "utf8"));
  const cfg = raw.installed || raw.web || raw;
  const clientId = cfg.client_id;
  const clientSecret = cfg.client_secret;
  if (!clientId || !clientSecret) {
    console.error("client_secret.json 형식이 올바르지 않습니다(client_id/client_secret 없음).");
    process.exit(1);
  }

  // 캐시된 토큰 재사용
  if (existsSync(TOKEN_PATH)) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials(JSON.parse(await readFile(TOKEN_PATH, "utf8")));
    oauth2.on("tokens", async (tokens) => {
      const merged = { ...oauth2.credentials, ...tokens };
      await writeFile(TOKEN_PATH, JSON.stringify(merged, null, 2));
    });
    return oauth2;
  }

  // 로컬 루프백 서버로 OAuth 코드 수신(데스크톱 앱은 임의 포트 허용)
  return await new Promise((resolvePromise, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      const authUrl = oauth2.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
      });

      server.on("request", async (req, res) => {
        try {
          const u = new URL(req.url, redirectUri);
          const code = u.searchParams.get("code");
          if (!code) {
            res.writeHead(400);
            res.end("인증 코드가 없습니다.");
            return;
          }
          const { tokens } = await oauth2.getToken(code);
          oauth2.setCredentials(tokens);
          await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h2>인증 완료! 터미널로 돌아가세요.</h2>");
          server.close();
          oauth2.on("tokens", async (t) => {
            const merged = { ...oauth2.credentials, ...t };
            await writeFile(TOKEN_PATH, JSON.stringify(merged, null, 2));
          });
          resolvePromise(oauth2);
        } catch (e) {
          res.writeHead(500);
          res.end("토큰 교환 실패: " + e.message);
          reject(e);
        }
      });

      console.log("\n브라우저에서 로그인/동의가 필요합니다. 자동으로 열리지 않으면 아래 URL 접속:");
      console.log(authUrl + "\n");
      const opener =
        process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      execCb(`${opener} "${authUrl}"`);
    });
  });
}

// ---------- 상태파일 ----------
async function loadState() {
  if (existsSync(STATE_PATH)) {
    try {
      return JSON.parse(await readFile(STATE_PATH, "utf8"));
    } catch {
      /* 손상 시 새로 시작 */
    }
  }
  return { uploaded: {} }; // { [filename]: { videoId, publishAt } }
}
async function saveState(state) {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

// ---------- 업로드 ----------
async function uploadOne(youtube, filePath, { title, publishAt }) {
  const status =
    PRIVACY != null
      ? { privacyStatus: String(PRIVACY), selfDeclaredMadeForKids: false }
      : { privacyStatus: "private", publishAt, selfDeclaredMadeForKids: false };

  const res = await youtube.videos.insert(
    {
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: title.slice(0, 100),
          description: `${title}\n\n#Shorts`,
          tags: ["shorts", "해숏티"],
          categoryId: CATEGORY_ID,
        },
        status,
      },
      media: { body: createReadStream(filePath) },
    },
    {
      // 대용량 대비 재시도 가능한 업로드 + 진행률 표시
      onUploadProgress: (evt) => {
        process.stdout.write(`\r  업로드 중... ${(evt.bytesRead / 1024 / 1024).toFixed(1)} MB`);
      },
    },
  );
  process.stdout.write("\n");
  return res.data;
}

// ---------- 메인 ----------
async function main() {
  if (!existsSync(DIR)) {
    console.error(`폴더가 없습니다: ${DIR}`);
    process.exit(1);
  }

  const entries = await readdir(DIR);
  const files = [];
  for (const name of entries) {
    if (!VIDEO_EXT.has(extname(name).toLowerCase())) continue;
    const full = join(DIR, name);
    const s = await stat(full);
    if (s.isFile()) files.push(name);
  }
  files.sort(); // 파일명(앞 날짜) 기준 오름차순 → 오래된 것부터

  if (files.length === 0) {
    console.log("업로드할 영상이 없습니다.");
    return;
  }

  const state = await loadState();
  const pending = files.filter((f) => !state.uploaded[f]);

  // 기본 시작일: 이미 예약된 게 있으면 "마지막 예약일 다음날", 없으면 "내일"
  // → 재실행 시 기존 예약 날짜와 겹치지 않고 자동으로 이어짐.
  function defaultStart() {
    const tomorrow = addDays(todayKstYmd(), 1);
    const scheduled = Object.values(state.uploaded)
      .map((v) => v.publishAt)
      .filter(Boolean)
      .sort();
    if (scheduled.length === 0) return tomorrow;
    const lastYmd = new Date(scheduled[scheduled.length - 1]) // UTC → KST 날짜
      .toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const next = addDays(lastYmd, 1);
    return next > tomorrow ? next : tomorrow;
  }
  const startYmd = String(flag("start", defaultStart()));
  console.log(`\n대상 폴더 : ${DIR}`);
  console.log(`전체 ${files.length}개 / 미업로드 ${pending.length}개`);
  console.log(
    PRIVACY != null
      ? `모드      : 즉시 ${PRIVACY} 업로드(예약 없음)`
      : `모드      : 예약 공개 — ${startYmd}부터 매일 ${TIME} (KST)\n`,
  );

  if (pending.length === 0) {
    console.log("모두 업로드 완료된 상태입니다.");
    return;
  }

  // 일정 미리보기
  const plan = pending.map((f, i) => {
    const ymd = addDays(startYmd, i);
    return { file: f, title: titleFromFilename(f), publishAt: publishAtIso(ymd, TIME), ymd };
  });
  for (const p of plan) {
    const when = PRIVACY != null ? "(즉시)" : `${p.ymd} ${TIME} KST 공개`;
    console.log(`  • ${when}  ${p.title}`);
  }

  if (DRY) {
    console.log("\n[dry-run] 실제 업로드는 하지 않았습니다.");
    return;
  }

  const auth = await getAuth();
  const youtube = google.youtube({ version: "v3", auth });

  for (const p of plan) {
    const filePath = join(DIR, p.file);
    console.log(`\n▶ 업로드: ${p.file}`);
    console.log(`  제목: ${p.title}`);
    if (PRIVACY == null) console.log(`  예약: ${p.ymd} ${TIME} KST`);
    try {
      const data = await uploadOne(youtube, filePath, p);
      state.uploaded[p.file] = { videoId: data.id, publishAt: p.publishAt };
      await saveState(state);
      console.log(`  완료 ✓  https://youtu.be/${data.id}`);
      if (DELETE_AFTER) {
        await rm(filePath, { force: true });
        console.log(`  삭제 ✓  ${p.file}`);
      }
    } catch (e) {
      const msg = e?.errors?.[0]?.reason || e?.message || String(e);
      console.error(`  실패 ✗  ${msg}`);
      if (/quota/i.test(msg)) {
        console.error("  할당량 초과로 중단합니다. 내일 다시 실행하면 이어서 진행됩니다.");
        break;
      }
    }
  }

  console.log("\n끝났습니다.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
