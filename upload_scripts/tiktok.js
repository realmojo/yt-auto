/**
 * TikTok 자동 업로드 데몬 (CommonJS 스탠드얼론) — playwright-extra + stealth.
 *  - 인증: upload_scripts/tiktok-auth.json (auth.js --id tiktok 로 저장한 storageState)
 *  - 영상: ../ranking_shuffled 에서 랜덤 1개 선택
 *  - 중복방지: 성공한 파일명을 tiktok-success.txt 에 기록, 업로드 전 비교해 제외(재업로드 X)
 *
 * 실행:
 *   node upload_scripts/tiktok.js            # 상시 실행(데몬): 10초마다 확인, 매일 18:00에 1회 업로드
 *   node upload_scripts/tiktok.js --now      # 지금 즉시 1회 업로드(테스트)
 *   node upload_scripts/tiktok.js --dry-run  # 지금 폼까지만 채우고 '게시' 직전 정지
 *   node upload_scripts/tiktok.js --plan     # 선택만 출력(브라우저 X)
 *   node upload_scripts/tiktok.js --headless # 창 숨김(기본은 보임=봇감지 완화)
 *   node upload_scripts/tiktok.js --tag "#fyp #쇼츠"
 *
 * 데몬은 종료 전까지 계속 돕니다(Ctrl+C 로 종료). 백그라운드: nohup node upload_scripts/tiktok.js &
 */
const { chromium } = require("playwright-extra")
const stealth = require("puppeteer-extra-plugin-stealth")()
const fs = require("fs")
const path = require("path")

chromium.use(stealth)

const AUTH_PATH = path.join(__dirname, "tiktok-auth.json")
const VIDEO_DIR = path.join(__dirname, "..", "ranking_shuffled")
const SUCCESS_PATH = path.join(__dirname, "tiktok-success.txt") // 업로드 성공 기록(파일명 한 줄씩)
const UPLOAD_URL =
  "https://www.tiktok.com/tiktokstudio/upload?from=webapp&tab=video"
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv"])

const FIRE_HOUR = 18 // 오후 6시
const FIRE_MIN = 0
const POLL_MS = 10000 // 10초마다 확인

// ---------- 인자 ----------
const argv = process.argv.slice(2)
const PLAN = argv.includes("--plan")
const DRY = argv.includes("--dry-run")
const NOW = argv.includes("--now")
const HEADLESS = argv.includes("--headless")
const tagIdx = argv.indexOf("--tag")
const HASHTAGS = tagIdx >= 0 && argv[tagIdx + 1] ? argv[tagIdx + 1] : "#랭킹쇼츠"

// ---------- 유틸 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rndDelay = () => Math.floor(Math.random() * 2000) + 3000 // 3~5초 (사람처럼)
const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
const stamp = () => new Date().toLocaleString("ko-KR")

/** tiktok-success.txt 에서 이미 올린 파일명 Set 로드 */
function loadSuccess() {
  try {
    return new Set(
      fs
        .readFileSync(SUCCESS_PATH, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    )
  } catch {
    return new Set() // 파일 없으면 빈 목록
  }
}
/** 성공한 파일명 한 줄 추가 */
function appendSuccess(name) {
  fs.appendFileSync(SUCCESS_PATH, name + "\n", "utf8")
}

/** ranking_shuffled 에서 (tiktok-success.txt 에 없는) 랜덤 1개. 다 올렸으면 null. */
function pickRandom() {
  if (!fs.existsSync(VIDEO_DIR))
    throw new Error(`영상 폴더가 없습니다: ${VIDEO_DIR}`)
  const all = fs
    .readdirSync(VIDEO_DIR)
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
  if (!all.length) throw new Error(`영상이 없습니다: ${VIDEO_DIR}`)

  const done = loadSuccess()
  const pool = all.filter((f) => !done.has(f)) // 이미 올린 건 제외
  if (!pool.length) return { pick: null, total: all.length, remain: 0 }
  const pick = pool[Math.floor(Math.random() * pool.length)]
  return { pick, total: all.length, remain: pool.length }
}

async function dismissJoyride(page) {
  // 업로드 후 뜨는 튜토리얼(Joyride) 오버레이가 있으면 닫는다
  try {
    const ov = page.locator('div[data-test-id="overlay"]').first()
    if (await ov.isVisible({ timeout: 300 }).catch(() => false)) {
      await ov.click({ position: { x: 8, y: 8 } }).catch(() => {})
    }
  } catch {
    /* 무시 */
  }
}

/** 랜덤 1개 골라 실제 업로드(성공 시 tiktok-success.txt 기록) */
async function runUpload() {
  if (!fs.existsSync(AUTH_PATH)) {
    throw new Error(
      `인증 파일이 없습니다: ${AUTH_PATH}\n먼저 'node upload_scripts/auth.js --id tiktok' 로 로그인하세요.`,
    )
  }

  const { pick, total, remain } = pickRandom()
  if (!pick) {
    console.log(`✅ 모든 영상(${total}개)이 이미 업로드됨 — 올릴 게 없습니다(재업로드 안 함).`)
    return
  }
  const videoPath = path.join(VIDEO_DIR, pick)
  const title = path.basename(pick, path.extname(pick))
  const caption = `${title} ${HASHTAGS}`.trim().slice(0, 2000)

  console.log(`🎬 선택: ${pick}  (남은 ${remain}/${total})`)
  console.log(`📝 캡션: ${caption}`)
  if (PLAN) {
    console.log("🅿️ [plan] 선택만 출력하고 종료(업로드 안 함).")
    return
  }

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
  })
  const context = await browser.newContext({
    storageState: AUTH_PATH, // 로그인 세션 복구
    viewport: { width: 1280, height: 720 },
    locale: "ko-KR",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  })
  const page = await context.newPage()

  try {
    console.log("→ 업로드 페이지 이동…")
    await page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" })
    await sleep(rndDelay())

    if (/\/(login|signup)/.test(page.url())) {
      throw new Error(
        "로그인 세션 만료. 'node upload_scripts/auth.js --id tiktok' 로 다시 로그인하세요.",
      )
    }

    // 1) 파일 선택 (hidden input도 setInputFiles 가능)
    console.log("→ 파일 선택…")
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.waitFor({ state: "attached", timeout: 60000 })
    await fileInput.setInputFiles(videoPath)

    // 2) 영상 처리 대기 — Joyride 닫으며 '게시' 버튼이 활성화될 때까지 (최대 ~150초)
    console.log("→ 영상 처리 대기…")
    const postBtn = () =>
      page.getByRole("button", { name: /^(Post|게시)$/ }).first()
    let ready = false
    for (let i = 0; i < 150; i++) {
      await sleep(1000)
      await dismissJoyride(page)
      const b = postBtn()
      const exists = await b.count().catch(() => 0)
      if (exists && !(await b.isDisabled().catch(() => true))) {
        ready = true
        break
      }
      if (i % 15 === 0) console.log(`   …처리 중 ${i}s`)
    }
    if (!ready) console.warn("   ⚠️ '게시' 활성화 확인 못함 — 그래도 진행 시도")

    await sleep(rndDelay())

    if (DRY) {
      console.log("🅳 [dry-run] '게시' 직전에서 정지(업로드 폼까지만).")
      await sleep(1500)
      return
    }

    // 3) 게시: Post(EN) 또는 게시(KO) → 지금 게시(KO 확인 모달)
    console.log("→ 게시…")
    const en = page.getByRole("button", { name: "Post", exact: true })
    const ko = page.getByRole("button", { name: "게시", exact: true })
    if (await en.isVisible().catch(() => false)) {
      await en.click()
    } else if (await ko.isVisible().catch(() => false)) {
      await ko.click()
      await sleep(rndDelay())
      const koNow = page.getByRole("button", { name: "지금 게시", exact: true })
      if (await koNow.isVisible().catch(() => false)) await koNow.click()
    } else {
      throw new Error("Post/게시 버튼을 찾지 못함 (TikTok UI 변경 가능).")
    }

    console.log("⏳ 게시 처리 대기(30초)…")
    await sleep(30000)

    // 성공 기록(재업로드 방지) — tiktok-success.txt 에 파일명 추가
    appendSuccess(pick)
    console.log(`✅ 업로드 완료 → tiktok-success.txt 기록: ${pick}`)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

/** 상시 데몬: 10초마다 시각 확인 → 매일 18:00 에 1회 업로드 */
async function scheduler() {
  console.log(
    `⏰ 데몬 시작 (${stamp()}) — 매일 ${String(FIRE_HOUR).padStart(2, "0")}:${String(FIRE_MIN).padStart(2, "0")}에 업로드. ${POLL_MS / 1000}초마다 확인. (Ctrl+C 종료)`,
  )
  let lastFireYmd = null // 하루 1회만 실행하기 위한 가드
  for (;;) {
    const now = new Date()
    const today = ymd(now)
    const hhmmss = now.toLocaleTimeString("ko-KR", { hour12: false })
    // 10초마다 확인 로그(현재 시각 포함)
    console.log(
      `🕒 ${now.toLocaleDateString("ko-KR")} ${hhmmss} — 확인 중 (매일 ${String(FIRE_HOUR).padStart(2, "0")}:${String(FIRE_MIN).padStart(2, "0")} 업로드)`,
    )
    if (
      now.getHours() === FIRE_HOUR &&
      now.getMinutes() === FIRE_MIN &&
      lastFireYmd !== today
    ) {
      lastFireYmd = today // 오늘은 실행함으로 표시(같은 분에 중복 실행 방지)
      console.log(`\n🔔 ${stamp()} — ${FIRE_HOUR}:00 도달, 업로드 실행`)
      try {
        await runUpload()
      } catch (e) {
        console.error("업로드 중 오류:", e.message)
      }
      console.log(`→ 다음 ${FIRE_HOUR}:00 대기…`)
    }
    await sleep(POLL_MS)
  }
}

// ---------- 엔트리 ----------
if (PLAN || DRY || NOW) {
  // 1회 실행(테스트/즉시)
  runUpload().catch((e) => {
    console.error("❌ 실패:", e.message)
    process.exit(1)
  })
} else {
  // 상시 데몬(매일 18:00)
  scheduler().catch((e) => {
    console.error("❌ 데몬 오류:", e.message)
    process.exit(1)
  })
}
