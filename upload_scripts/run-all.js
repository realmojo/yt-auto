/**
 * 업로드 데몬 3개를 한 번에 실행 (시간 엇갈리게).
 *   tiktok    18:00
 *   clip      18:05
 *   instagram 18:10
 *
 * 사용:
 *   node upload_scripts/run-all.js              # 3개 데몬 상시 실행
 *   node upload_scripts/run-all.js --headless   # 뒤에 붙인 옵션은 3개에 그대로 전달
 *
 * 각 로그는 [tiktok]/[clip]/[instagram] 접두사로 구분. 크래시 시 5초 후 자동 재시작.
 * Ctrl+C 로 전체 종료. (각 데몬은 자기 시각에만 브라우저를 띄우고 평소엔 10초 폴링만 함)
 */
const { spawn } = require("child_process")
const path = require("path")

const passthrough = process.argv.slice(2) // 예: --headless

const JOBS = [
  { name: "tiktok", script: "tiktok.js", args: [] }, //            18:00 (기본)
  { name: "clip", script: "clip.js", args: ["--min", "5"] }, //    18:05
  { name: "instagram", script: "instagram.js", args: ["--min", "10"] }, // 18:10
]

const children = []
let shuttingDown = false

function pipe(stream, out, tag) {
  let buf = ""
  stream.on("data", (d) => {
    buf += d.toString()
    const lines = buf.split("\n")
    buf = lines.pop() // 마지막 미완성 라인은 보류
    for (const l of lines) out.write(`${tag} ${l}\n`)
  })
}

function start(job) {
  const tag = `[${job.name}]`
  const child = spawn(
    "node",
    [path.join(__dirname, job.script), ...job.args, ...passthrough],
    { cwd: path.join(__dirname, ".."), env: process.env },
  )
  children.push(child)
  pipe(child.stdout, process.stdout, tag)
  pipe(child.stderr, process.stderr, tag)
  child.on("exit", (code) => {
    if (shuttingDown) return
    console.log(`${tag} 종료(code ${code}) — 5초 후 재시작`)
    setTimeout(() => start(job), 5000) // 크래시 자동 복구
  })
}

process.on("SIGINT", () => {
  shuttingDown = true
  console.log("\n▪ 종료 중… 데몬 정리")
  for (const c of children) c.kill("SIGTERM")
  setTimeout(() => process.exit(0), 1000)
})

console.log("▶ 업로드 데몬 시작 — tiktok 18:00 · clip 18:05 · instagram 18:10  (Ctrl+C 종료)")
for (const j of JOBS) start(j)
