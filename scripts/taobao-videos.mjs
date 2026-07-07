#!/usr/bin/env node
/**
 * 타오바오 상품 "홍보영상" 수집기 — Playwright(+stealth)로 실제 Chrome 조작.
 * 검색 결과 페이지의 각 상품 카드에는 영상아이콘(videoIcon)이 있고, 호버하면
 * <video src="https://cloud.video.taobao.com/.../*.mp4"> 가 로드된다.
 * → 상세페이지에 들어가지 않고, 검색 결과에서 카드별로 호버→video src를 읽어 바로 다운로드.
 *
 * 사용
 *   최초 1회 로그인:   node scripts/taobao-videos.mjs --login
 *   검색 수집:         node scripts/taobao-videos.mjs --search "蘑菇加湿器" --max 20
 *   검색 URL로:        node scripts/taobao-videos.mjs --url "https://s.taobao.com/search?q=..." --max 20
 *   슬라이더 뜰 때:    창에서 직접 밀어 통과 → 터미널 Enter (또는 --wait 60 자동대기)
 *
 * ⚠️ 타오바오 웹 자동화는 약관상 회색지대입니다. 본인 계정·합법적 용도로만.
 *    스크린샷은 scripts/.taobao-debug/ 에 남깁니다.
 */
import { addExtra } from "playwright-extra";
import { chromium as pwChromium } from "playwright-core";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const chromium = addExtra(pwChromium);
chromium.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ---------- 인자 ----------
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return def;
  const a = args[i];
  const eq = a.indexOf("=");
  if (eq !== -1) return a.slice(eq + 1);
  const next = args[i + 1];
  if (next !== undefined && !next.startsWith("--")) return next;
  return true;
};
const LOGIN = args.includes("--login");
const HEADLESS = args.includes("--headless");
const NO_DOWNLOAD = args.includes("--no-download"); // 수집만(메타+커버+영상URL), mp4 다운로드 X
const ALL = args.includes("--all"); // 1페이지의 영상 카드를 전부(개수제한 없이) 수집
const DOWNLOAD_LIST = flag("download-list", null); // JSON파일 [{url,dest}] 을 받아 그것만 다운로드
const SEARCH = flag("search", null);
const SEARCH_URL = flag("url", null);
const MAX = parseInt(String(flag("max", "20")), 10) || 20;
const WAIT = flag("wait", null) ? parseInt(String(flag("wait", "0")), 10) : null;
const PROFILE = resolve(ROOT, String(flag("profile", "scripts/.taobao-profile")));
const OUT = resolve(ROOT, String(flag("out", "taobao_videos")));
const DEBUG_DIR = resolve(ROOT, "scripts/.taobao-debug");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await mkdir(DEBUG_DIR, { recursive: true });
  await page.screenshot({ path: join(DEBUG_DIR, `${name}.png`) }).catch(() => {});
}

function sanitize(t) {
  return (
    (t || "")
      .replace(/[\\/:*?"<>|\n\r\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || ""
  );
}

async function isBlocked(page) {
  const u = page.url();
  if (/login\.taobao|login\.tmall|\/punish|nocaptcha/i.test(u)) return true;
  const txt = (await page.content().catch(() => "")).slice(0, 6000);
  return /unusual traffic|滑动验证|滑块|安全验证|밀어서|Sorry, we have detected/i.test(txt);
}

async function pauseForHuman(msg) {
  console.log("\n⏸  " + msg);
  if (WAIT) {
    console.log(`   (--wait ${WAIT}s 자동대기)`);
    await sleep(WAIT * 1000);
    return;
  }
  if (process.stdin.isTTY) {
    console.log("   준비되면 이 터미널에서 [Enter]…");
    await new Promise((res) => {
      process.stdin.resume();
      process.stdin.once("data", () => {
        process.stdin.pause();
        res();
      });
    });
  } else {
    console.log("   (비대화형 → 60초 대기 후 진행)");
    await sleep(60000);
  }
}

// ---------- 로그인 ----------
// 페이지 이동 없이 로그인 쿠키로 판별(민감페이지 리다이렉트 오판 방지).
// unb(회원번호)·lgc·tracknick 는 로그인 상태에서만 설정된다.
async function isLoggedIn(context) {
  const cookies = await context.cookies("https://www.taobao.com").catch(() => []);
  const names = new Set(cookies.map((c) => c.name));
  return ["unb", "lgc", "tracknick", "_nk_"].some((n) => names.has(n) && !!cookies.find((c) => c.name === n && c.value));
}

async function ensureLogin(context, page) {
  if (await isLoggedIn(context)) {
    console.log("✓ 타오바오 로그인 상태");
    return true;
  }
  if (!LOGIN) throw new Error("로그인이 안 돼 있습니다. 먼저 `--login` 으로 1회 로그인하세요.");
  console.log("\n브라우저 창에서 타오바오에 로그인하세요(QR/비밀번호). (최대 5분)");
  await page.goto("https://login.taobao.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(4000);
    if (await isLoggedIn(context)) {
      console.log("\n✓ 로그인 완료.");
      return true;
    }
    process.stdout.write(".");
  }
  throw new Error("로그인 시간 초과.");
}

// ---------- 다운로드 ----------
async function download(context, page, referer, id, title, src) {
  const nm = `${id}${title ? "_" + title : ""}.mp4`;
  const outPath = join(OUT, nm);
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => "");
  const resp = await context.request.get(src, {
    headers: { referer, "user-agent": ua },
    timeout: 90000,
  });
  if (!resp.ok()) {
    console.warn(`  ⚠️ 다운로드 응답 ${resp.status()} (${nm})`);
    return null;
  }
  await writeFile(outPath, await resp.body());
  return outPath;
}

// ---------- 검색결과에서 카드별 호버→영상 수집 ----------
async function collectFromSearch(context, page) {
  let url = SEARCH_URL;
  if (!url && SEARCH) url = `https://s.taobao.com/search?q=${encodeURIComponent(SEARCH)}`;
  if (!url) throw new Error("--search 또는 --url 이 필요합니다.");
  console.log(`▶ 검색: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(3500);
  await shot(page, "search-1");
  if (await isBlocked(page)) {
    await shot(page, "search-blocked");
    await pauseForHuman("슬라이더/보안검증이 떴습니다. 창에서 직접 밀어 통과 후 진행하세요.");
  }

  // 호버 중 로드되는 mp4 네트워크 요청도 백업으로 캡처
  const netMp4 = new Set();
  const cap = (u) => {
    if (/cloud\.video\.taobao\.com|\.mp4(\?|$)/i.test(u)) netMp4.add(u);
  };
  page.on("response", (r) => cap(r.url()));
  page.on("request", (r) => cap(r.url()));

  const results = [];
  const seenId = new Set();
  const seenSrc = new Set();
  let totalCards = 0,
    videoCards = 0,
    hovered = 0;

  // --all: 1페이지의 영상 카드를 전부 수집(개수제한 없이, 새 카드 안 늘 때까지 스크롤).
  const CAP = ALL ? 300 : MAX; // 안전 상한
  const MAX_ROUNDS = ALL ? 40 : 14;
  let stale = 0;

  // 여러 번 스크롤하며 카드가 로드될 때마다 호버해서 영상 src 확보
  for (let round = 0; round < MAX_ROUNDS && results.length < CAP; round++) {
    const beforeSeen = seenId.size;
    // 카드: id="item_id_숫자" 컨테이너(태그 무관)
    const cards = await page.$$('[id^="item_id_"]');
    for (const card of cards) {
      if (results.length >= CAP) break;
      const id = await card.evaluate((el) => (el.id.match(/item_id_(\d+)/) || [])[1] || "");
      if (!id || seenId.has(id)) continue;
      seenId.add(id);
      totalCards++;
      // 영상 아이콘/비디오 요소 있는 카드만
      const hasVideo = await card.$('[class*="videoIcon"], [class*="videox"], video');
      if (!hasVideo) continue;
      videoCards++;

      await card.scrollIntoViewIfNeeded().catch(() => {});
      // 이미지/영상 컨테이너 위를 호버(카드 중앙=텍스트일 수 있어 이미지 영역을 노림)
      const hoverTarget =
        (await card.$('[class*="videox-container"]')) ||
        (await card.$('[class*="mainPic"]')) ||
        (await card.$("img")) ||
        card;
      await hoverTarget.hover().catch(() => {});
      hovered++;
      await sleep(1600); // 호버 후 video src 채워질 시간

      const info = await card.evaluate((el) => {
        const v = el.querySelector("video");
        const src = v ? v.currentSrc || v.getAttribute("src") || "" : "";
        const a = el.querySelector('a[href*="item.htm"]');
        let title =
          (a && (a.getAttribute("title") || a.innerText)) ||
          (el.innerText || "").split("\n").find((s) => s.trim().length > 4) ||
          "";
        // 커버 이미지: video poster 또는 상품 대표 이미지(alicdn)
        const img = el.querySelector('[class*="videox-container"] img, [class*="mainPic"] img, img');
        const cover = (v && v.getAttribute("poster")) || (img && (img.getAttribute("src") || img.src)) || "";
        return { src, title, cover, hasVideoEl: !!v };
      });

      if (info.src && /\.mp4/i.test(info.src) && !seenSrc.has(info.src)) {
        seenSrc.add(info.src);
        results.push({ id, title: sanitize(info.title), src: info.src, cover: info.cover || "" });
        console.log(`  + [${results.length}] ${id}  ${sanitize(info.title).slice(0, 30)}`);
      } else {
        console.log(`  - ${id} 영상아이콘O video엘리먼트=${info.hasVideoEl} src=${info.src ? "있음(mp4아님?)" : "없음"}`);
      }
    }
    const added = seenId.size - beforeSeen;
    if (ALL && added === 0) {
      stale++;
      if (stale >= 3) break; // 새 카드가 더 안 늘면 1페이지 끝
    } else {
      stale = 0;
    }
    await page.mouse.wheel(0, 1600);
    await sleep(1000 + Math.round(Math.random() * 500));
    if (await isBlocked(page)) await pauseForHuman("보안검증이 다시 떴습니다. 통과 후 진행.");
  }
  console.log(`  진단: 카드 ${totalCards} / 영상아이콘 ${videoCards} / 호버 ${hovered} / DOM수집 ${results.length}${ALL ? " (1페이지 전체)" : ""}`);

  // 네트워크로만 잡힌 mp4 보충(커버·제목 없음) — ALL 모드에선 광고/빈썸네일 노이즈라 제외
  if (!ALL) {
    for (const u of netMp4) {
      if (results.length >= CAP) break;
      if (![...seenSrc].some((s) => s.split("?")[0] === u.split("?")[0])) {
        const m = u.match(/\/u\/(\d+)\//);
        results.push({ id: (m && m[1]) || "net", title: "", src: u, cover: "" });
        seenSrc.add(u);
      }
    }
  }

  await shot(page, "search-2");
  console.log(`  영상 카드 ${results.length}개 수집(네트워크 백업 포함).`);
  return { url, results };
}

// ---------- 메인 ----------
async function main() {
  await mkdir(PROFILE, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: HEADLESS,
    viewport: { width: 1400, height: 950 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    chromiumSandbox: true, // --no-sandbox 경고 배너 제거
    ignoreDefaultArgs: ["--no-sandbox", "--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled", "--mute-audio", "--lang=zh-CN"],
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = context.pages()[0] || (await context.newPage());

  try {
    await ensureLogin(context, page);
    if (LOGIN) return;

    // 다운로드 전용 모드: JSON파일 [{url,dest}] 을 받아 그것만 저장(검색 안 함)
    if (DOWNLOAD_LIST) {
      const list = JSON.parse(await readFile(DOWNLOAD_LIST, "utf8"));
      let ok = 0;
      for (let i = 0; i < list.length; i++) {
        const { url: u, dest, id } = list[i];
        process.stdout.write(`\n[${i + 1}/${list.length}] ${id || ""} 다운로드… `);
        try {
          const ua = await page.evaluate(() => navigator.userAgent).catch(() => "");
          const resp = await context.request.get(u, {
            headers: { referer: "https://s.taobao.com/", "user-agent": ua },
            timeout: 90000,
          });
          if (resp.ok()) {
            await writeFile(dest, await resp.body());
            ok++;
            console.log(`✔ ${dest.split("/").pop()}`);
          } else console.log(`✗ HTTP ${resp.status()}`);
        } catch (e) {
          console.log(`✗ ${e.message}`);
        }
      }
      console.log(`\n다운로드 완료: ${ok}/${list.length}`);
      return;
    }

    const { url, results } = await collectFromSearch(context, page);
    if (!results.length) {
      console.log("수집된 영상이 없습니다. (영상 없는 상품이거나 셀렉터 조정 필요 — .taobao-debug 스샷 확인)");
      return;
    }

    // 수집만(다운로드 X): 메타+커버+영상URL 만 index.json 에 기록
    if (NO_DOWNLOAD) {
      await writeFile(
        join(OUT, "index.json"),
        JSON.stringify(
          {
            keyword: SEARCH || SEARCH_URL || "",
            count: results.length,
            collectedAt: new Date().toISOString(),
            items: results.map((r) => ({ id: r.id, title: r.title, videoUrl: r.src, cover: r.cover || "" })),
          },
          null,
          2,
        ),
      ).catch(() => {});
      console.log(`\n수집 완료(다운로드 X): ${results.length}개 → ${join(OUT, "index.json")}`);
      return;
    }

    let ok = 0;
    const saved = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      process.stdout.write(`\n[${i + 1}/${results.length}] ${r.id} 다운로드… `);
      try {
        const p = await download(context, page, url, r.id, r.title, r.src);
        if (p) {
          ok++;
          const file = p.split("/").pop();
          saved.push({ id: r.id, title: r.title, file });
          console.log(`✔ ${file}`);
        }
      } catch (e) {
        console.log(`✗ ${e.message}`);
      }
    }
    // 결과 색인(웹 UI가 읽어 목록/메타 표시)
    await writeFile(
      join(OUT, "index.json"),
      JSON.stringify(
        { keyword: SEARCH || SEARCH_URL || "", count: saved.length, collectedAt: new Date().toISOString(), items: saved },
        null,
        2,
      ),
    ).catch(() => {});
    console.log(`\n완료: 저장 ${ok}/${results.length}  → ${OUT}`);
  } finally {
    await context.close();
  }
}

main().catch((e) => {
  console.error("\n❌ 실패:", e.stack || e.message);
  process.exit(1);
});
