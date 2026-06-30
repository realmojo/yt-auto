#!/usr/bin/env node
/**
 * TikTok 업로드 — 공식 API 대신 Playwright로 TikTok 크리에이터 스튜디오 웹 UI를 조작.
 * 로그인 세션을 "영구 프로필"에 저장해 재사용하므로 앱 심사/토큰 발급이 필요 없다.
 * (TikTok API엔 예약 공개 파라미터가 없어 cron으로 매일 정해진 시각에 "즉시 게시"하는 방식)
 *
 * 사용
 *   최초 1회 로그인:   node scripts/tiktok-upload.mjs --login
 *   1개 즉시 게시:     node scripts/tiktok-upload.mjs               # output 폴더 가장 오래된 1개
 *   여러 개 연속:      node scripts/tiktok-upload.mjs --all
 *   드라이런(게시X):   node scripts/tiktok-upload.mjs --dry-run     # Post 직전까지만 + 스크린샷
 *   웹 예약 사용:      node scripts/tiktok-upload.mjs --at "2026-07-01 18:00"   # (베스트에포트)
 *   헤드리스:          node scripts/tiktok-upload.mjs --headless     # 기본은 창 보임(봇감지 완화)
 *
 * cron 예 (매일 18:00 KST 즉시 1개 게시):
 *   0 18 * * *  cd /path/to/yt-auto && /usr/local/bin/node scripts/tiktok-upload.mjs >> /tmp/tiktok.log 2>&1
 *
 * ⚠️ TikTok 웹 UI는 자주 바뀝니다 → 셀렉터가 깨질 수 있어 단계별 스크린샷을 scripts/.tiktok-debug/ 에 남깁니다.
 * ⚠️ 웹 자동화는 TikTok 약관상 회색지대입니다. 본인 계정·본인 콘텐츠를 본인 책임하에 올리는 용도로만 쓰세요.
 */
import { chromium } from "playwright-core";
import { readdir, stat, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload";

// ---------- 인자 ----------
const args = process.argv.slice(2);
const flag = (name, def) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return def;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
};
const DIR = resolve(ROOT, String(flag("dir", "output")));
const PROFILE = resolve(ROOT, String(flag("profile", "scripts/.tiktok-profile")));
const DEBUG_DIR = resolve(ROOT, "scripts/.tiktok-debug");
const STATE_PATH = join(DIR, ".tiktok-upload-state.json");
const LOGIN = args.includes("--login");
const DRY = args.includes("--dry-run");
const ALL = args.includes("--all");
const HEADLESS = args.includes("--headless");
const AT = flag("at", null); // "YYYY-MM-DD HH:mm" (KST) — TikTok 웹 예약
const CAPTION_SUFFIX = String(flag("caption", "#shorts #해숏티"));
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv"]);

// ---------- 유틸 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await mkdir(DEBUG_DIR, { recursive: true });
  await page.screenshot({ path: join(DEBUG_DIR, `${name}.png`) }).catch(() => {});
}

function titleFromFilename(p) {
  let t = basename(p, extname(p))
    .replace(/^\d{6,8}[_-]/, "") // 날짜 프리픽스
    .replace(/\s*\[[^\]]+\]\s*/g, " ") // [영상ID]
    .replace(/-?해숏티$/, "")
    .trim();
  if (!t) t = basename(p, extname(p));
  return t;
}

async function loadState() {
  if (existsSync(STATE_PATH)) {
    try {
      return JSON.parse(await readFile(STATE_PATH, "utf8"));
    } catch {
      /* 손상 시 새로 */
    }
  }
  return { uploaded: {} }; // { [filename]: { at, ok } }
}
async function saveState(s) {
  await writeFile(STATE_PATH, JSON.stringify(s, null, 2));
}

/** 메인 페이지 + 모든 iframe 에서 셀렉터를 찾아 첫 로케이터 반환(없으면 null) */
async function firstAcross(page, selector, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const f of [page, ...page.frames()]) {
      const loc = f.locator(selector).first();
      if (await loc.count().catch(() => 0)) return loc;
    }
    await sleep(800);
  }
  return null;
}

// ---------- 로그인 ----------
async function isLoggedIn(page) {
  await page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(3500);
  if (/\/(login|signup)/.test(page.url())) return false;
  // 로그인 상태면 업로드용 file input 이 (메인 or iframe 에) 존재
  const input = await firstAcross(page, 'input[type="file"]', 8000);
  return !!input;
}

async function ensureLogin(page) {
  if (await isLoggedIn(page)) {
    console.log("✓ 로그인 상태");
    return true;
  }
  if (!LOGIN) {
    throw new Error(
      "로그인이 안 돼 있습니다. 먼저 `node scripts/tiktok-upload.mjs --login` 으로 1회 로그인하세요.",
    );
  }
  console.log("\n브라우저에서 TikTok에 로그인하세요(이 창에서). 로그인 완료를 기다립니다… (최대 5분)");
  await page.goto("https://www.tiktok.com/login", { waitUntil: "domcontentloaded" }).catch(() => {});
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    if (await isLoggedIn(page)) {
      console.log("✓ 로그인 완료 — 세션이 프로필에 저장됐습니다.");
      return true;
    }
    process.stdout.write(".");
  }
  throw new Error("로그인 시간 초과.");
}

// ---------- 업로드 ----------
async function setSchedule(page) {
  // 베스트에포트: "예약/Schedule" 라디오를 켜고 날짜/시간 입력 시도 (UI 변경 시 수동 보정 필요)
  try {
    const radio = await firstAcross(page, 'text=/^(Schedule|예약)$/', 6000);
    if (radio) await radio.click({ timeout: 4000 }).catch(() => {});
    await sleep(1500);
    const [ymd, hm] = String(AT).trim().split(/\s+/);
    // 시간 input (HH:mm)
    const timeInput = await firstAcross(page, 'input[placeholder*=":"], input[value*=":"]', 4000);
    if (timeInput && hm) {
      await timeInput.click().catch(() => {});
      await timeInput.fill(hm).catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
    }
    console.log(`   ⏰ 예약 시도: ${ymd} ${hm} (UI 확인 필요)`);
  } catch {
    console.warn("   ⚠️ 예약 설정 셀렉터 실패 — 스크린샷 확인 후 수동 보정 필요.");
  }
}

async function uploadOne(page, file) {
  const title = titleFromFilename(file);
  const caption = `${title} ${CAPTION_SUFFIX}`.trim().slice(0, 2100);
  console.log(`\n▶ 업로드: ${basename(file)}`);
  console.log(`  캡션: ${caption}`);

  await page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" });
  await sleep(2500);

  // 1) 파일 선택
  const input = await firstAcross(page, 'input[type="file"]', 30000);
  if (!input) throw new Error("파일 input 못 찾음(로그인/UI 변경). .tiktok-debug 확인.");
  await input.setInputFiles(file);
  await sleep(2500);
  await shot(page, "1-after-file");

  // 2) 업로드/처리 대기 → 캡션 에디터(contenteditable) 등장까지
  const cap = await firstAcross(page, 'div[contenteditable="true"]', 120000);
  if (!cap) throw new Error("캡션 에디터 못 찾음(업로드 처리 지연/UI 변경). .tiktok-debug 확인.");

  // 3) 캡션 입력 (기존 파일명 자동입력분 지우고 새로)
  await cap.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
  await cap.type(caption, { delay: 15 });
  await page.keyboard.press("Escape"); // 해시태그 자동완성 닫기
  await sleep(800);
  await shot(page, "2-after-caption");

  // 4) (옵션) 웹 예약
  if (AT) await setSchedule(page);

  // 5) Post 버튼: 보일 때까지 + 업로드 처리 끝나 활성화될 때까지
  const post = await firstAcross(page, 'button:has-text("Post"), button:has-text("게시")', 30000);
  if (!post) throw new Error("Post 버튼 못 찾음. .tiktok-debug 확인.");
  for (let i = 0; i < 90; i++) {
    if (!(await post.isDisabled().catch(() => false))) break;
    await sleep(2000); // 영상 처리 중 disabled
  }
  await shot(page, "3-before-post");

  if (DRY) {
    console.log("  [dry-run] Post 직전에서 정지 (게시 안 함). 스크린샷: scripts/.tiktok-debug/");
    return { dryRun: true };
  }

  await post.click({ timeout: 10000 });
  // 성공: 토스트/모달 또는 콘텐츠 목록으로 이동 — 보수적으로 대기
  await sleep(9000);
  await shot(page, "4-after-post");
  console.log("  게시 클릭 완료(성공 여부는 스크린샷/계정에서 확인).");
  return { posted: true };
}

// ---------- 메인 ----------
async function pickFiles(state) {
  if (!existsSync(DIR)) throw new Error(`폴더 없음: ${DIR}`);
  const names = (await readdir(DIR)).filter((n) => VIDEO_EXT.has(extname(n).toLowerCase()));
  const files = [];
  for (const n of names) {
    if ((await stat(join(DIR, n))).isFile() && !state.uploaded[n]) files.push(n);
  }
  files.sort(); // 파일명(앞 날짜) 오름차순 → 오래된 것부터
  return files;
}

async function main() {
  await mkdir(PROFILE, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: HEADLESS,
    viewport: { width: 1366, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || (await context.newPage());

  try {
    await ensureLogin(page);
    if (LOGIN) return; // 로그인만 하고 종료

    const state = await loadState();
    const files = await pickFiles(state);
    if (!files.length) {
      console.log("업로드할(미게시) 영상이 없습니다.");
      return;
    }
    console.log(`대상 폴더: ${DIR} · 미게시 ${files.length}개${ALL ? " (전체)" : " (1개)"}`);

    const targets = ALL ? files : files.slice(0, 1);
    for (const f of targets) {
      try {
        const r = await uploadOne(page, join(DIR, f));
        if (r.posted) {
          state.uploaded[f] = { at: new Date().toISOString(), ok: true };
          await saveState(state);
        }
      } catch (e) {
        console.error(`  실패 ✗ ${f}: ${e.message}`);
        await shot(page, `err-${f}`).catch(() => {});
        if (!ALL) break;
      }
      if (ALL) await sleep(4000);
    }
  } finally {
    await context.close();
  }
  console.log("\n끝.");
}

main().catch((e) => {
  console.error("\n❌ 실패:", e.stack || e.message);
  process.exit(1);
});
