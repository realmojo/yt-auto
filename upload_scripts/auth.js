const { chromium } = require("playwright-extra")
const stealth = require("puppeteer-extra-plugin-stealth")()
const path = require("path")

chromium.use(stealth)

const authPath = path.join(__dirname, `clip-auth.json`)

;(async () => {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ko-KR",
  })
  const page = await context.newPage()

  console.log(`저장 경로: ${authPath}`)
  console.log("Navigating to Naver Login page...")

  // url 변경해서 하면 됌
  // 틱톡: https://tiktok.com
  // 틱톡: https://instagram.com
  // 틱톡: https://clipcreators.naver.com/web/upload
  await page.goto("https://clipcreators.naver.com/web/upload")

  console.log("⚠️ 1분 동안 수동 로그인을 진행해주세요! (QR코드, 2단계 인증 등)")
  console.log("로그인이 완료되면 자동으로 인증 정보가 저장됩니다.")

  for (let i = 10; i > 0; i--) {
    await page.waitForTimeout(10000)
    console.log(`... ${i * 10}초 남음`)
  }

  console.log(`Saving auth state to ${authPath}...`)
  await context.storageState({ path: authPath })

  console.log(`✅ Auth state saved! → ${authPath}`)

  await browser.close()
})()
