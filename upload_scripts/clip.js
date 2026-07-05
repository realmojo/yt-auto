/**
 * 네이버 클립(Naver Clip) 자동 업로드 데몬 (CommonJS 스탠드얼론) — playwright-extra + stealth.
 * 공식 API 안 씀. PC 브라우저(로그인 세션)로 클립 크리에이터 웹 업로드 UI를 조작.
 *  - 인증: upload_scripts/clip-auth.json (이 스크립트 --login 으로 생성 — 네이버 로그인)
 *  - 영상: ../ranking_shuffled 에서 랜덤 1개 선택
 *  - 제목: 파일명(순수 제목) → '경험을 기록해보세요' 설명란에 입력
 *  - 카테고리: 1차/2차 (기본 유머/유머, --cat1 / --cat2 로 변경)
 *  - 중복방지: 성공한 파일명을 clip-success.txt 에 기록, 업로드 전 비교해 제외(재업로드 X)
 *
 * 실행:
 *   node upload_scripts/clip.js --login    # 최초 1회: 창에서 네이버 로그인 → 세션 저장
 *   node upload_scripts/clip.js            # 데몬: 10초마다 확인, 매일 18:00 1회 업로드
 *   node upload_scripts/clip.js --now      # 지금 즉시 1회 업로드(테스트)
 *   node upload_scripts/clip.js --dry-run  # '등록' 직전까지만(게시 안 함) + 스크린샷
 *   node upload_scripts/clip.js --plan     # 선택만 출력(브라우저 X)
 *   node upload_scripts/clip.js --hour 20  # 발사 시각 변경(기본 18)
 *   node upload_scripts/clip.js --cat1 유머 --cat2 유머
 *
 * ⚠️ 클립 웹 UI가 바뀌면 셀렉터가 깨질 수 있어 단계별 스크린샷을 upload_scripts/.clip-debug/ 에 남깁니다.
 */
const { chromium } = require("playwright-extra")
const stealth = require("puppeteer-extra-plugin-stealth")()
const fs = require("fs")
const path = require("path")

chromium.use(stealth)

const AUTH_PATH = path.join(__dirname, "clip-auth.json")
const VIDEO_DIR = path.join(__dirname, "..", "ranking_shuffled")
const SUCCESS_PATH = path.join(__dirname, "clip-success.txt")
const DEBUG_DIR = path.join(__dirname, ".clip-debug")
const UPLOAD_URL = "https://clipcreators.naver.com/web/upload"
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv"])
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"

const POLL_MS = 10000 // 10초마다 확인

// ---------- 인자 ----------
const argv = process.argv.slice(2)
const LOGIN = argv.includes("--login")
const PLAN = argv.includes("--plan")
const DRY = argv.includes("--dry-run")
const NOW = argv.includes("--now")
const HEADLESS = argv.includes("--headless")
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const FIRE_HOUR = parseInt(arg("hour", "18"), 10)
const FIRE_MIN = parseInt(arg("min", "0"), 10)
const CAT1 = arg("cat1", "유머")
const CAT2 = arg("cat2", "유머")

// ---------- 유틸 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rndDelay = () => Math.floor(Math.random() * 2000) + 3000
const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
const stamp = () => new Date().toLocaleString("ko-KR")

async function shot(page, name) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true })
    await page.screenshot({ path: path.join(DEBUG_DIR, `${name}.png`) })
  } catch {
    /* 무시 */
  }
}

/** locator 가 timeout 안에 보이면 true (waitFor 기반 — locator.isVisible 은 대기 안 함) */
async function appears(locator, timeout = 8000) {
  try {
    await locator.waitFor({ state: "visible", timeout })
    return true
  } catch {
    return false
  }
}

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
    return new Set()
  }
}
function appendSuccess(name) {
  fs.appendFileSync(SUCCESS_PATH, name + "\n", "utf8")
}

/** ranking_shuffled 에서 (clip-success.txt 에 없는) 랜덤 1개. 다 올렸으면 null. */
function pickRandom() {
  if (!fs.existsSync(VIDEO_DIR))
    throw new Error(`영상 폴더가 없습니다: ${VIDEO_DIR}`)
  const all = fs
    .readdirSync(VIDEO_DIR)
    .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
  if (!all.length) throw new Error(`영상이 없습니다: ${VIDEO_DIR}`)
  const done = loadSuccess()
  const pool = all.filter((f) => !done.has(f))
  if (!pool.length) return { pick: null, total: all.length, remain: 0 }
  const pick = pool[Math.floor(Math.random() * pool.length)]
  return { pick, total: all.length, remain: pool.length }
}

// ---------- 로그인 ----------
async function isLoggedIn(page) {
  if (/nid\.naver\.com|\/login/.test(page.url())) return false // 네이버 로그인 페이지면 미로그인
  const hasUpload = await page.locator('input[type="file"]').count().catch(() => 0)
  return hasUpload > 0 || page.url().includes("clipcreators.naver.com")
}

async function login() {
  const browser = await chromium.launch({
    headless: false, // 로그인은 반드시 창 띄움(수동 입력/2단계 인증)
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
  })
  const context = await browser.newContext({ locale: "ko-KR", userAgent: UA })
  const page = await context.newPage()
  await page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" })
  console.log("\n창에서 네이버에 로그인하세요(2단계 인증 포함). 완료를 기다립니다… (최대 5분)")
  const deadline = Date.now() + 5 * 60 * 1000
  let ok = false
  while (Date.now() < deadline) {
    await sleep(5000)
    if (page.url().includes("clipcreators.naver.com") && (await isLoggedIn(page))) {
      await context.storageState({ path: AUTH_PATH })
      console.log(`✅ 로그인 세션 저장: ${AUTH_PATH}`)
      ok = true
      break
    }
    process.stdout.write(".")
  }
  await browser.close()
  if (!ok) throw new Error("로그인 시간 초과.")
}

// ---------- 업로드 ----------
/** 열려 있는 드롭다운 메뉴에서 옵션(텍스트) 클릭 */
async function pickCategory(page, text) {
  const opt = page
    .locator('[class*="dropdownMenuWrap"] button[class*="dropdownOption"]')
    .filter({ hasText: text })
    .first()
  if (!(await appears(opt, 8000))) throw new Error(`카테고리 '${text}' 옵션을 못 찾음`)
  await opt.click()
}

async function runUpload() {
  if (!PLAN && !fs.existsSync(AUTH_PATH)) {
    throw new Error(
      `인증 파일이 없습니다: ${AUTH_PATH}\n먼저 'node upload_scripts/clip.js --login' 으로 로그인하세요.`,
    )
  }
  const { pick, total, remain } = pickRandom()
  if (!pick) {
    console.log(`✅ 모든 영상(${total}개)이 이미 업로드됨 — 올릴 게 없습니다(재업로드 안 함).`)
    return
  }
  const videoPath = path.join(VIDEO_DIR, pick)
  const title = path.basename(pick, path.extname(pick)).slice(0, 300) // 순수 제목(최대 300자)
  console.log(`🎬 선택: ${pick}  (남은 ${remain}/${total})`)
  console.log(`📝 제목: ${title}  · 카테고리: ${CAT1} > ${CAT2}`)
  if (PLAN) {
    console.log("🅿️ [plan] 선택만 출력하고 종료(업로드 안 함).")
    return
  }

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
  })
  const context = await browser.newContext({
    storageState: AUTH_PATH,
    viewport: { width: 1280, height: 900 },
    locale: "ko-KR",
    userAgent: UA,
  })
  const page = await context.newPage()

  try {
    console.log("→ 업로드 페이지 이동…")
    await page.goto(UPLOAD_URL, { waitUntil: "domcontentloaded" })
    await sleep(rndDelay())
    if (!(await isLoggedIn(page))) {
      throw new Error("로그인 세션 만료 → 'node upload_scripts/clip.js --login' 다시.")
    }
    await shot(page, "1-upload")

    // 1) 파일 선택
    console.log("→ 파일 선택…")
    const fileInput = page.locator('input[type="file"]').first()
    await fileInput.waitFor({ state: "attached", timeout: 30000 })
    await fileInput.setInputFiles(videoPath)

    // 2) 상세 폼(설명란) 등장 대기 → 제목 입력
    console.log("→ 제목 입력…")
    const desc = page.locator('textarea[name="description"]').first()
    if (!(await appears(desc, 60000)))
      throw new Error("설명(제목) 입력란을 못 찾음 — .clip-debug 확인.")
    await desc.click()
    await desc.fill(title)
    await shot(page, "2-title")

    // 3) 1차 카테고리 → 선택
    console.log(`→ 1차 카테고리: ${CAT1}…`)
    await page.locator('button[class*="dropdownPrimary"]').first().click()
    await sleep(700)
    await pickCategory(page, CAT1)
    await sleep(700)
    await shot(page, "3-cat1")

    // 4) 2차 카테고리 → 선택
    console.log(`→ 2차 카테고리: ${CAT2}…`)
    await page.locator('button[class*="dropdownSecondary"]').first().click()
    await sleep(700)
    await pickCategory(page, CAT2)
    await sleep(700)
    await shot(page, "4-cat2")

    // 5) 영상 처리 대기(약 60초) + '등록' 활성화 확인
    console.log("⏳ 영상 처리 대기(약 60초)…")
    await sleep(60000)
    const submit = page.locator('button[type="submit"][class*="submitBtn"]').first()
    if (!(await appears(submit, 60000)))
      throw new Error("'등록' 버튼을 못 찾음 — .clip-debug 확인.")
    for (let i = 0; i < 60; i++) {
      if (!(await submit.isDisabled().catch(() => true))) break // aria-disabled=false 될 때까지
      await sleep(1000)
    }
    await shot(page, "5-before-submit")

    if (DRY) {
      console.log("🅳 [dry-run] '등록' 직전 정지(게시 안 함). 스크린샷: upload_scripts/.clip-debug/")
      await sleep(1500)
      return
    }

    // 6) 등록
    console.log("→ 등록…")
    await submit.click()
    await sleep(15000)
    await shot(page, "6-submitted")

    appendSuccess(pick)
    console.log(`✅ 업로드 완료 → clip-success.txt 기록: ${pick}`)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

/** 상시 데몬: 10초마다 시각 확인(로그) → 매일 FIRE_HOUR:FIRE_MIN 에 1회 업로드 */
async function scheduler() {
  const hh = String(FIRE_HOUR).padStart(2, "0")
  const mm = String(FIRE_MIN).padStart(2, "0")
  console.log(`⏰ 클립 데몬 시작 (${stamp()}) — 매일 ${hh}:${mm} 업로드. ${POLL_MS / 1000}초마다 확인. (Ctrl+C 종료)`)
  let lastFireYmd = null
  for (;;) {
    const now = new Date()
    const today = ymd(now)
    const hhmmss = now.toLocaleTimeString("ko-KR", { hour12: false })
    console.log(`🕒 ${now.toLocaleDateString("ko-KR")} ${hhmmss} — 확인 중 (매일 ${hh}:${mm} 업로드)`)
    if (
      now.getHours() === FIRE_HOUR &&
      now.getMinutes() === FIRE_MIN &&
      lastFireYmd !== today
    ) {
      lastFireYmd = today
      console.log(`\n🔔 ${stamp()} — ${hh}:${mm} 도달, 업로드 실행`)
      try {
        await runUpload()
      } catch (e) {
        console.error("업로드 중 오류:", e.message)
      }
      console.log(`→ 다음 ${hh}:${mm} 대기…`)
    }
    await sleep(POLL_MS)
  }
}

// ---------- 엔트리 ----------
if (LOGIN) {
  login().catch((e) => {
    console.error("❌ 로그인 실패:", e.message)
    process.exit(1)
  })
} else if (PLAN || DRY || NOW) {
  runUpload().catch((e) => {
    console.error("❌ 실패:", e.message)
    process.exit(1)
  })
} else {
  scheduler().catch((e) => {
    console.error("❌ 데몬 오류:", e.message)
    process.exit(1)
  })
}
