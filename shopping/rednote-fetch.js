/**
 * 샤오홍수(小红书 / RedNote) 레퍼런스 영상 수집기 — playwright-extra + stealth.
 * 공식 API를 안 쓰고, 로그인 세션(브라우저)을 재사용해 검색 결과의 "영상 노트"를 긁어온다.
 * 유튜브 쇼핑 쇼츠 제작 시 참고할 레퍼런스(구성/편집/BGM/자막)를 모으는 용도.
 *
 *   1) 이미지 + 키워드를 입력 → 샤오홍수에서 해당 키워드 영상 검색
 *   2) 노트(카드) 목록을 스크롤하며 수집(제목/작성자/좋아요/썸네일/노트URL)
 *   3) --download 시 각 노트를 열어 원본 영상까지 내려받음
 *   4) 결과를 shopping/refs/<키워드>/index.json 로 저장(+ 입력 이미지 복사)
 *
 * 실행:
 *   최초 1회 로그인:  node shopping/rednote-fetch.js --login
 *   검색만(메타 수집): node shopping/rednote-fetch.js --keyword "电风扇" --limit 20
 *   영상까지 다운로드: node shopping/rednote-fetch.js --keyword "电风扇" --limit 12 --download
 *   이미지 함께 저장:  node shopping/rednote-fetch.js --keyword "户外风扇" --image ~/Desktop/fan.jpg
 *   창 보이게:         node shopping/rednote-fetch.js --keyword "电风扇" --headful
 *
 * 참고:
 *  - type=51 은 "영상" 필터. source/keyword 는 예시 URL과 동일하게 구성.
 *  - 검색 결과 열람에는 로그인이 필요할 수 있음 → --login 으로 1회 세션 저장.
 *  - 샤오홍수 웹 DOM은 자주 바뀜 → 단계별 스크린샷/HTML을 shopping/.rednote-debug/ 에 남김.
 *  - 웹 자동화·크롤링은 서비스 약관상 회색지대. 개인 리서치/레퍼런스 용도로만, 본인 책임하에.
 */
const { chromium } = require("playwright-extra")
const stealth = require("puppeteer-extra-plugin-stealth")()
const fs = require("fs")
const path = require("path")

chromium.use(stealth)

// ---------- 경로/상수 ----------
const ROOT = path.resolve(__dirname, "..")
// 로그인 세션(쿠키+localStorage)을 JSON에 저장했다가 다음 실행 때 storageState로 복구한다
// (upload_scripts/auth.js·clip.js 와 동일한 방식).
const AUTH_PATH = path.join(__dirname, "rednote-auth.json")
const REFS_DIR = path.join(__dirname, "refs")
const DEBUG_DIR = path.join(__dirname, ".rednote-debug")
// 계정 세션은 rednote.com(국제판 RedNote) 도메인에 붙는다 — 로그인 후 rednote.com/explore 로 이동됨.
// xiaohongshu.com 으로 가면 세션이 없어 로그인 모달이 뜬다.
const BASE = "https://www.rednote.com"
const LOGIN_URL = `${BASE}/explore`
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"

// ---------- 인자 ----------
const argv = process.argv.slice(2)
const has = (n) => argv.includes(`--${n}`)
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def
}
const LOGIN = has("login")
const DOWNLOAD = has("download")
const HEADFUL = has("headful")
const KEYWORD = arg("keyword", argv.find((a) => !a.startsWith("--")) || "")
const LIMIT = parseInt(arg("limit", "20"), 10)
const IMAGE = arg("image", null)
const MAX_SCROLL = parseInt(arg("scrolls", "40"), 10)

// ---------- 유틸 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rnd = (a, b) => Math.floor(Math.random() * (b - a)) + a
const stamp = () => new Date().toLocaleString("ko-KR")
const slug = (s) =>
  String(s)
    .trim()
    .replace(/[\/\\:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60) || "keyword"

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true })
}
async function shot(page, name) {
  ensureDir(DEBUG_DIR)
  await page.screenshot({ path: path.join(DEBUG_DIR, `${name}.png`), fullPage: false }).catch(() => {})
}
async function dumpHtml(page, name) {
  ensureDir(DEBUG_DIR)
  try {
    fs.writeFileSync(path.join(DEBUG_DIR, `${name}.html`), await page.content())
  } catch {}
}

function searchUrl(keyword) {
  const enc = encodeURIComponent(keyword)
  return `${BASE}/search_result?keyword=${enc}&source=web_explore_feed&type=51`
}

// ---------- 브라우저 ----------
async function openBrowser(headless, wantAuth = false) {
  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
  })
  const ctxOpts = {
    locale: "zh-CN",
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
  }
  if (wantAuth && fs.existsSync(AUTH_PATH)) ctxOpts.storageState = AUTH_PATH
  const context = await browser.newContext(ctxOpts)
  return { browser, context }
}

// ---------- 로그인 ----------
function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, () => {
      rl.close()
      resolve()
    })
  })
}

async function login() {
  const { browser, context } = await openBrowser(false) // 로그인은 반드시 창 띄움(QR/문자 인증)
  const page = await context.newPage()
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {})
  console.log("\n창에서 샤오홍수(小红书)에 로그인하세요(QR 스캔 또는 문자 인증).")
  // DOM 자동감지는 리로드 순간 오탐하므로, 사용자가 직접 완료를 알려주는 방식(가장 확실)
  await waitForEnter("→ 로그인을 완료했으면 이 터미널에서 Enter 를 누르세요… ")

  // 검증: 새로고침 후에도 로그인 모달이 없어야 진짜 로그인
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" }).catch(() => {})
  await sleep(3500)
  if (await loginModalShown(page)) {
    await shot(page, "login_verify_failed")
    await browser.close()
    throw new Error(
      "로그인이 확인되지 않았습니다(여전히 로그인 모달이 보임). 창에서 실제로 로그인한 뒤 다시 시도하세요.",
    )
  }
  await context.storageState({ path: AUTH_PATH })
  console.log(`\n✅ 로그인 확인 완료 — 세션 저장: ${AUTH_PATH}`)
  await browser.close()
}

/** 로그인 모달(手机号登录/扫码/登录后…)이 화면에 떠 있으면 true = 아직 미로그인. */
async function loginModalShown(page) {
  return await page
    .evaluate(() => {
      const t = document.body ? document.body.innerText : ""
      return /手机号登录|扫码|登录后查看|新用户可直接登录|获取验证码/.test(t)
    })
    .catch(() => false)
}

/** 로그인 여부: 로그인 모달이 없으면 로그인된 것으로 본다. */
async function isLoggedIn(page) {
  return !(await loginModalShown(page))
}

// ---------- 검색 결과 수집 ----------
/** 페이지의 노트 카드들에서 메타데이터를 추출(브라우저 컨텍스트에서 실행). */
async function extractCards(page) {
  return await page.evaluate(() => {
    const txt = (el) => (el ? (el.textContent || "").trim() : "")
    const abs = (h) => (h ? new URL(h, location.origin).href : "")
    const out = []
    const seen = new Set()
    const sections = document.querySelectorAll('[class*="note-item"]')
    sections.forEach((sec) => {
      // xsec_token 이 담긴 앵커(cover/title) 우선 — 숨겨진 첫 앵커엔 토큰이 없다
      const linkEl =
        sec.querySelector('a.cover[href*="xsec_token"]') ||
        sec.querySelector('a.title[href*="xsec_token"]') ||
        sec.querySelector('a[href*="/search_result/"][href*="xsec_token"]') ||
        sec.querySelector('a[href*="/search_result/"], a[href*="/explore/"]')
      if (!linkEl) return
      const href = linkEl.getAttribute("href") || ""
      const m = href.match(/\/(?:search_result|explore)\/([0-9a-f]{16,})/i)
      if (!m) return
      const id = m[1]
      if (seen.has(id)) return
      seen.add(id)

      const coverImg = sec.querySelector("a.cover img") || sec.querySelector("img")
      const authorA = sec.querySelector("a.author")
      out.push({
        id,
        url: abs(href).split("?")[0],
        xsecUrl: abs(href), // xsec_token 포함 — 상세 페이지 진입/다운로드에 필요
        title: txt(sec.querySelector("a.title span, a.title, .footer .title")),
        author: txt(sec.querySelector(".author .name, .name-time-wrapper .name")),
        authorUrl: authorA ? abs(authorA.getAttribute("href")).split("?")[0] : "",
        time: txt(sec.querySelector(".author .time, .name-time-wrapper .time")),
        likes: txt(sec.querySelector(".like-wrapper .count, .like-active .count")),
        isVideo: !!sec.querySelector(".play-icon"),
        cover: (coverImg && (coverImg.getAttribute("src") || coverImg.getAttribute("data-src"))) || "",
      })
    })
    return out
  })
}

async function collect(page) {
  const map = new Map()
  let stale = 0
  for (let i = 0; i < MAX_SCROLL && map.size < LIMIT; i++) {
    const cards = await extractCards(page)
    let added = 0
    for (const c of cards) {
      if (!map.has(c.id)) {
        map.set(c.id, c)
        added++
      } else {
        // 재조우 시 지연 렌더된 빈 필드(제목/작성자/좋아요/커버) 채움
        const prev = map.get(c.id)
        for (const k of ["title", "author", "authorUrl", "time", "likes", "cover"]) {
          if (!prev[k] && c[k]) prev[k] = c[k]
        }
      }
    }
    console.log(`  · 스크롤 ${i + 1}: 누적 ${map.size}개 (이번 +${added})`)
    if (added === 0) {
      stale++
      if (stale >= 4) break // 더 안 늘면 종료
    } else stale = 0
    await page.mouse.wheel(0, rnd(1600, 2600))
    await sleep(rnd(900, 1800))
  }
  return [...map.values()].slice(0, LIMIT)
}

// ---------- 노트 상세: 원본 영상 URL 추출 ----------
// rednote CDN 영상 URL은 rednotecdn.com/stream/... 형태로 .mp4 확장자가 없다.
const isVideoUrl = (u) =>
  /\.mp4(\?|$)/i.test(u) || /rednotecdn\.com\/stream\//i.test(u) || /(sns-video|xhscdn)[^"]*stream/i.test(u)

async function resolveVideo(context, note) {
  const page = await context.newPage()
  let videoUrl = ""
  try {
    // 응답 스니핑: 영상 스트림 요청이 지나가면 잡는다(확장자 없는 stream URL 포함)
    page.on("response", (res) => {
      const u = res.url()
      const ct = res.headers()["content-type"] || ""
      if (!videoUrl && (isVideoUrl(u) || ct.startsWith("video/"))) videoUrl = u
    })
    await page.goto(note.xsecUrl || note.url, { waitUntil: "domcontentloaded" }).catch(() => {})
    // 1) <video> 엘리먼트에 src가 붙을 때까지 폴링(지연 로드 대비, 최대 ~10초)
    for (let i = 0; i < 20 && !videoUrl; i++) {
      videoUrl = await page
        .evaluate(() => {
          const v = document.querySelector("video")
          return (v && (v.currentSrc || v.getAttribute("src") || "")) || ""
        })
        .catch(() => "")
      if (videoUrl) break
      await sleep(500)
    }
    // 2) __INITIAL_STATE__ 안의 masterUrl(확장자 무관) 탐색
    if (!videoUrl) {
      videoUrl = await page
        .evaluate(() => {
          try {
            const j = JSON.stringify(window.__INITIAL_STATE__)
            const m =
              j.match(/"masterUrl":"([^"]+)"/) ||
              j.match(/"(https?:[^"]+(?:\.mp4|rednotecdn\.com\/stream)[^"]*)"/)
            return m ? m[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/") : ""
          } catch {
            return ""
          }
        })
        .catch(() => "")
    }
  } finally {
    await page.close().catch(() => {})
  }
  return videoUrl
}

async function downloadTo(context, url, dest) {
  const resp = await context.request.get(url, {
    headers: { referer: BASE + "/", "user-agent": UA },
  })
  if (!resp.ok()) throw new Error(`HTTP ${resp.status()}`)
  fs.writeFileSync(dest, await resp.body())
}

// ---------- 메인 ----------
async function run() {
  if (!KEYWORD) {
    throw new Error('키워드가 필요합니다. 예) node shopping/rednote-fetch.js --keyword "电风扇"')
  }
  if (!fs.existsSync(AUTH_PATH)) {
    throw new Error(
      `인증 파일이 없습니다: ${AUTH_PATH}\n먼저 'node shopping/rednote-fetch.js --login' 으로 샤오홍수에 로그인하세요.`,
    )
  }

  const outDir = path.join(REFS_DIR, slug(KEYWORD))
  ensureDir(outDir)

  // 입력 이미지 저장(레퍼런스 폴더에 함께 보관)
  let savedImage = null
  if (IMAGE) {
    if (!fs.existsSync(IMAGE)) throw new Error(`이미지를 찾을 수 없음: ${IMAGE}`)
    savedImage = path.join(outDir, "input" + path.extname(IMAGE))
    fs.copyFileSync(IMAGE, savedImage)
    console.log(`🖼  입력 이미지 저장: ${savedImage}`)
  }

  const { browser, context } = await openBrowser(!HEADFUL, true)
  const page = await context.newPage()

  const url = searchUrl(KEYWORD)
  console.log(`\n🔎 검색: "${KEYWORD}"  (영상 필터 type=51)\n   ${url}`)
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {})
  await sleep(3500)
  await shot(page, `search_${slug(KEYWORD)}`)

  if (!(await isLoggedIn(page))) {
    await dumpHtml(page, "not_logged_in")
    console.warn("⚠️ 로그인 상태가 아닌 것으로 보입니다. 결과가 비어있으면 --login 을 다시 실행하세요.")
  }

  console.log("📜 스크롤하며 수집 중…")
  const notes = await collect(page)
  console.log(`\n✅ 노트 ${notes.length}개 수집`)

  if (notes.length === 0) await dumpHtml(page, `empty_${slug(KEYWORD)}`)

  // 다운로드(옵션)
  if (DOWNLOAD && notes.length) {
    const videoDir = path.join(outDir, "videos")
    ensureDir(videoDir)
    console.log("\n⬇️  원본 영상 추출/다운로드…")
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]
      try {
        const v = await resolveVideo(context, n)
        n.videoUrl = v || ""
        if (v) {
          const dest = path.join(videoDir, `${String(i + 1).padStart(2, "0")}_${n.id}.mp4`)
          await downloadTo(context, v, dest)
          n.videoFile = path.relative(outDir, dest)
          console.log(`  ✓ [${i + 1}/${notes.length}] ${n.id} → ${n.videoFile}`)
        } else {
          console.log(`  ⚠ [${i + 1}/${notes.length}] ${n.id} 영상 URL 못 찾음`)
        }
      } catch (e) {
        console.log(`  ✗ [${i + 1}/${notes.length}] ${n.id} 실패: ${e.message}`)
      }
      await sleep(rnd(800, 1600))
    }
  }

  // 결과 저장
  const result = {
    keyword: KEYWORD,
    searchUrl: url,
    image: savedImage ? path.relative(outDir, savedImage) : null,
    count: notes.length,
    collectedAt: stamp(),
    notes,
  }
  const outJson = path.join(outDir, "index.json")
  fs.writeFileSync(outJson, JSON.stringify(result, null, 2))
  console.log(`\n💾 저장: ${outJson}`)

  await browser.close()
}

// ---------- 엔트리 ----------
;(async () => {
  try {
    console.log(`[${stamp()}] rednote-fetch 시작`)
    if (LOGIN) await login()
    else await run()
    console.log(`[${stamp()}] 완료`)
  } catch (e) {
    console.error(`\n❌ ${e.message}`)
    process.exit(1)
  }
})()
