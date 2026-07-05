/**
 * Instagram 자동 업로드 데몬 (CommonJS 스탠드얼론) — playwright-extra + stealth.
 * 공식 API 안 씀. PC 브라우저(로그인 세션)로 인스타 웹 업로드 UI를 조작.
 *  - 인증: upload_scripts/instagram-auth.json (이 스크립트 --login 으로 생성)
 *  - 영상: ../ranking_shuffled 에서 랜덤 1개 선택
 *  - 중복방지: 성공한 파일명을 instagram-success.txt 에 기록, 업로드 전 비교해 제외(재업로드 X)
 *
 * 실행:
 *   node upload_scripts/instagram.js --login    # 최초 1회: 창에서 인스타 로그인 → 세션 저장
 *   node upload_scripts/instagram.js            # 데몬: 10초마다 확인, 매일 18:00 1회 업로드
 *   node upload_scripts/instagram.js --now      # 지금 즉시 1회 업로드(테스트)
 *   node upload_scripts/instagram.js --dry-run  # '공유하기' 직전까지만(게시 안 함) + 스크린샷
 *   node upload_scripts/instagram.js --plan     # 선택만 출력(브라우저 X)
 *   node upload_scripts/instagram.js --hour 19  # 발사 시각 변경(기본 18)
 *   node upload_scripts/instagram.js --headless
 *
 * ⚠️ 인스타 웹 UI는 자주/난독화되어 바뀝니다 → 셀렉터가 깨질 수 있어 단계별 스크린샷을
 *    upload_scripts/.ig-debug/ 에 남깁니다. 실제 게시는 --dry-run 으로 먼저 확인하세요.
 */
const { chromium } = require("playwright-extra")
const stealth = require("puppeteer-extra-plugin-stealth")()
const fs = require("fs")
const path = require("path")

chromium.use(stealth)

const AUTH_PATH = path.join(__dirname, "instagram-auth.json")
const VIDEO_DIR = path.join(__dirname, "..", "ranking_shuffled")
const SUCCESS_PATH = path.join(__dirname, "instagram-success.txt")
const DEBUG_DIR = path.join(__dirname, ".ig-debug")
const HOME_URL = "https://www.instagram.com/"
const LOGIN_URL = "https://www.instagram.com/accounts/login/"
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

/** ranking_shuffled 에서 (instagram-success.txt 에 없는) 랜덤 1개. 다 올렸으면 null. */
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

// ---------- 로그인 판별/저장 ----------
async function isLoggedIn(page) {
  const hasPw = await page.locator('input[name="password"]').count().catch(() => 0)
  if (hasPw) return false
  const nav = await page
    .locator(
      'svg[aria-label="홈"], svg[aria-label="Home"], svg[aria-label="새로운 게시물"], svg[aria-label="새 게시물"], svg[aria-label="New post"]',
    )
    .count()
    .catch(() => 0)
  return nav > 0
}

/** 로그인 후/홈에서 뜨는 "정보 저장/알림 켜기" 등 팝업 닫기 */
async function dismissDialogs(page) {
  for (const name of [/나중에 하기/, /^Not Now$/, /^Not now$/, /지금 하지 않기/]) {
    const b = page.getByRole("button", { name }).first()
    if (await b.isVisible().catch(() => false)) {
      await b.click().catch(() => {})
      await sleep(800)
    }
  }
}

async function login() {
  const browser = await chromium.launch({
    headless: false, // 로그인은 반드시 창 띄움(수동 입력/2단계 인증)
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
  })
  const context = await browser.newContext({ locale: "ko-KR", userAgent: UA })
  const page = await context.newPage()
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" })
  console.log("\n창에서 인스타그램에 로그인하세요(2단계 인증 포함). 완료를 기다립니다… (최대 5분)")
  const deadline = Date.now() + 5 * 60 * 1000
  let ok = false
  while (Date.now() < deadline) {
    await sleep(5000)
    if (!/accounts\/login/.test(page.url()) && (await isLoggedIn(page))) {
      await dismissDialogs(page)
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
/** 문구(캡션) 입력창 로케이터 (Lexical contenteditable: aria-label/placeholder "문구를 입력하세요...") */
const captionField = (page) =>
  page.locator(
    'div[contenteditable="true"][aria-label*="문구"], div[contenteditable="true"][aria-placeholder*="문구"], textarea[aria-label*="문구"]',
  )

async function runUpload() {
  if (!PLAN && !fs.existsSync(AUTH_PATH)) {
    throw new Error(
      `인증 파일이 없습니다: ${AUTH_PATH}\n먼저 'node upload_scripts/instagram.js --login' 으로 로그인하세요.`,
    )
  }
  const { pick, total, remain } = pickRandom()
  if (!pick) {
    console.log(`✅ 모든 영상(${total}개)이 이미 업로드됨 — 올릴 게 없습니다(재업로드 안 함).`)
    return
  }
  const videoPath = path.join(VIDEO_DIR, pick)
  const title = path.basename(pick, path.extname(pick))
  const caption = title.slice(0, 2000) // 순수 제목만(해시태그 없음)
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
    storageState: AUTH_PATH,
    viewport: { width: 1280, height: 900 },
    locale: "ko-KR",
    userAgent: UA,
  })
  const page = await context.newPage()

  try {
    console.log("→ 인스타 홈 이동…")
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded" })
    await sleep(rndDelay())
    if (!(await isLoggedIn(page))) {
      throw new Error("로그인 세션 만료 → 'node upload_scripts/instagram.js --login' 다시.")
    }
    await dismissDialogs(page)
    await shot(page, "1-home")

    // 1) '만들기' 클릭 → 메뉴에서 '게시물'
    console.log("→ 만들기…")
    const createBtn = page.locator('svg[aria-label="새로운 게시물"]').first()
    await createBtn.waitFor({ state: "visible", timeout: 20000 })
    await createBtn.click()
    await sleep(1500)
    const postItem = page
      .locator('a[role="link"]:has(svg[aria-label="게시물"])')
      .first()
    if (await postItem.isVisible().catch(() => false)) {
      await postItem.click()
    } else {
      const byText = page.getByText("게시물", { exact: true }).first()
      if (await byText.isVisible().catch(() => false)) await byText.click()
    }
    await sleep(2000)
    await shot(page, "2-create")

    // 2) 파일 선택 ('새 게시물 만들기' 모달의 동영상 input)
    console.log("→ 파일 선택…")
    const fileInput = page
      .locator('input[type="file"][accept*="video"], input[type="file"]')
      .first()
    await fileInput.waitFor({ state: "attached", timeout: 20000 })
    await fileInput.setInputFiles(videoPath)
    await sleep(4000) // 영상 처리 대기
    await shot(page, "3-file")

    // 3.5) '동영상 게시물이 릴스로 공유됩니다' 안내 모달 → '확인' (비율 선택 전에)
    const reelsOk = page.getByRole("button", { name: "확인", exact: true }).first()
    if (await appears(reelsOk, 12000)) {
      console.log("→ 릴스 안내 '확인'…")
      await reelsOk.click()
      await sleep(1500)
      await shot(page, "3b-reels-ok")
    }

    // 4) 자르기(비율) 버튼 → 9:16 선택
    console.log("→ 9:16 비율…")
    const cropBtn = page
      .locator('button:has(svg[aria-label="자르기 선택"])')
      .first()
    if (await appears(cropBtn, 20000)) {
      await cropBtn.click()
      await sleep(1200)
      const r916 = page
        .locator(
          'div[role="button"]:has(svg[aria-label="세로 방향 자르기 아이콘"])',
        )
        .first()
      if (await r916.isVisible().catch(() => false)) {
        await r916.click()
        await sleep(1000)
      } else {
        console.warn("   ⚠️ 9:16 옵션 못 찾음 — 기본 비율로 진행.")
      }
    } else {
      console.warn("   ⚠️ 자르기 버튼 못 찾음 — 기본 비율로 진행.")
    }
    await shot(page, "4-crop")

    // 4) '다음' → '다음' (편집 → 문구 화면). 문구 입력창 뜰 때까지 최대 3번.
    console.log("→ 다음…")
    for (let step = 0; step < 3; step++) {
      if (await captionField(page).count().catch(() => 0)) break
      const next = page.getByRole("button", { name: "다음", exact: true }).first()
      if (await next.isVisible().catch(() => false)) {
        await next.click()
        await sleep(2000)
        await shot(page, `5-next${step}`)
      } else break
    }

    // 5) 문구(캡션) 입력 — Lexical 에디터는 insertText 가 한글에 안정적
    console.log("→ 문구 입력…")
    const cap = captionField(page).first()
    if (await cap.count().catch(() => 0)) {
      await cap.click()
      await page.keyboard.insertText(caption)
    } else {
      console.warn("   ⚠️ 문구 입력창 못 찾음 — .ig-debug 확인.")
    }
    await sleep(rndDelay())
    await shot(page, "6-caption")

    if (DRY) {
      console.log("🅳 [dry-run] '공유하기' 직전 정지(게시 안 함). 스크린샷: upload_scripts/.ig-debug/")
      await sleep(1500)
      return
    }

    // 6) 공유하기 → 완료까지 60초 대기
    console.log("→ 공유하기…")
    const share = page
      .getByRole("button", { name: "공유하기", exact: true })
      .first()
    if (!(await share.isVisible().catch(() => false)))
      throw new Error("'공유하기' 버튼을 못 찾음 (UI 변경 가능). .ig-debug 확인.")
    await share.click()

    console.log("⏳ 업로드 완료 대기(60초)…")
    await sleep(60000)
    await shot(page, "7-shared")

    appendSuccess(pick)
    console.log(`✅ 업로드 완료 → instagram-success.txt 기록: ${pick}`)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

/** 상시 데몬: 10초마다 시각 확인(로그) → 매일 FIRE_HOUR:FIRE_MIN 에 1회 업로드 */
async function scheduler() {
  const hh = String(FIRE_HOUR).padStart(2, "0")
  const mm = String(FIRE_MIN).padStart(2, "0")
  console.log(`⏰ 인스타 데몬 시작 (${stamp()}) — 매일 ${hh}:${mm} 업로드. ${POLL_MS / 1000}초마다 확인. (Ctrl+C 종료)`)
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
