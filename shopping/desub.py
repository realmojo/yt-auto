#!/usr/bin/env python3
"""영상의 번인 중국어 자막을 AI 인페인팅(LaMa)으로 제거.
흐름: 프레임추출 → 시간대별 자막영역 OCR감지(Apple Vision, 중국어) → 마스크 →
      자막 있는 프레임만 iopaint(LaMa, MPS)로 인페인팅 → 원본 오디오와 재조립.

사용: python3 desub.py <입력.mp4> <출력.mp4> [--interval 0.4] [--pad 8] [--min-conf 0.3]
필요: shopping/ocrbox(컴파일됨), iopaint(pip), ffmpeg.
"""
import sys, os, re, subprocess, tempfile, shutil, glob
from PIL import Image, ImageDraw

WORK = os.path.dirname(os.path.abspath(__file__))
OCRBOX = os.path.join(WORK, "ocrbox")
FFMPEG = os.environ.get("FFMPEG_BIN", "/opt/homebrew/bin/ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "/opt/homebrew/bin/ffprobe")
# iopaint CLI — 이 스크립트를 실행한 파이썬(venv 등) 옆의 실행파일을 우선 사용
IOPAINT = os.path.join(os.path.dirname(sys.executable), "iopaint")
if not os.path.exists(IOPAINT):
    IOPAINT = "iopaint"

CJK = re.compile(r"[㐀-鿿豈-﫿぀-ヿ]")  # 한자/가나(중국어 자막 위주)


def sh(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def probe(v, entries):
    r = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries", entries,
         "-of", "default=nw=1:nk=1", v], capture_output=True, text=True)
    return r.stdout.strip().splitlines()


def probe_fps(v):
    for line in probe(v, "stream=r_frame_rate"):
        if "/" in line:
            a, b = line.split("/"); return float(a) / float(b) if float(b) else 25.0
    return 25.0


def probe_dur(v):
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", v], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def ocr_boxes(img, min_conf):
    """중국어(CJK) 텍스트의 정규화 박스(Vision 좌하단원점) 목록."""
    r = subprocess.run([OCRBOX, img], capture_output=True, text=True)
    out = []
    for line in r.stdout.splitlines():
        p = line.split("\t")
        if len(p) < 6:
            continue
        try:
            x, y, w, h, conf = (float(p[i]) for i in range(5))
        except ValueError:
            continue
        text = p[5]
        if conf < min_conf or not CJK.search(text):
            continue
        out.append((x, y, w, h))
    return out


def mask_from_boxes(W, H, boxes, pad):
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    for (x, y, w, h) in boxes:
        left = x * W - pad
        right = (x + w) * W + pad
        top = (1 - (y + h)) * H - pad  # Vision y=box하단 → 이미지 top-origin 변환
        bot = (1 - y) * H + pad
        d.rectangle([max(0, left), max(0, top), min(W, right), min(H, bot)], fill=255)
    return m


def main():
    if len(sys.argv) < 3:
        print("사용: python3 desub.py <입력.mp4> <출력.mp4> [--interval N] [--pad N] [--min-conf N]")
        sys.exit(1)
    inp, outp = sys.argv[1], sys.argv[2]
    args = sys.argv[3:]

    def opt(name, default):
        return float(args[args.index(name) + 1]) if name in args else default

    interval = opt("--interval", 0.4)
    pad = int(opt("--pad", 8))
    min_conf = opt("--min-conf", 0.3)

    fps = probe_fps(inp)
    dur = probe_dur(inp)
    tmp = tempfile.mkdtemp(prefix="desub_")
    frames = os.path.join(tmp, "frames"); os.makedirs(frames)
    indir = os.path.join(tmp, "in"); os.makedirs(indir)
    mskdir = os.path.join(tmp, "msk"); os.makedirs(mskdir)
    outdir = os.path.join(tmp, "out"); os.makedirs(outdir)
    try:
        # 1) 전체 프레임 추출
        sh([FFMPEG, "-y", "-i", inp, "-qscale:v", "2", os.path.join(frames, "%06d.png")])
        frame_files = sorted(glob.glob(os.path.join(frames, "*.png")))
        if not frame_files:
            raise RuntimeError("프레임 추출 실패")
        W, H = Image.open(frame_files[0]).size

        # 2) interval 간격으로 OCR 샘플 → 시간대별 자막 박스
        samples = {}
        n_s = max(1, int(dur / interval) + 1)
        for i in range(n_s):
            t = i * interval
            sp = os.path.join(tmp, f"s{i}.png")
            subprocess.run([FFMPEG, "-y", "-ss", f"{t}", "-i", inp, "-frames:v", "1", sp],
                           capture_output=True)
            samples[i] = ocr_boxes(sp, min_conf) if os.path.exists(sp) else []
        n_sub_samples = sum(1 for b in samples.values() if b)
        print(f"  샘플 {n_s}개 중 자막감지 {n_sub_samples}개 · fps={fps:.2f} · 프레임 {len(frame_files)}")

        # 자막이 전혀 없으면 원본 그대로 복사
        all_boxes = [b for bs in samples.values() for b in bs]
        if not all_boxes:
            print("  자막 미감지 — 원본 복사")
            shutil.copyfile(inp, outp)
            return

        def px(b):
            x, y, w, h = b
            return (x * W, (1 - (y + h)) * H, (x + w) * W, (1 - y) * H)  # l,t,r,b

        # 3) 자막 프레임: 그 프레임 자막 박스의 union 만큼만 crop(위치가 장면마다 달라도 crop은 작게)
        M = 24  # crop 여유(문맥)
        sub_names = []
        offsets = {}
        for idx, ff in enumerate(frame_files):
            ftime = idx / fps
            sidx = round(ftime / interval)
            boxes = samples.get(sidx, [])  # 가장 가까운 샘플만(위치 혼합 방지)
            if not boxes:
                continue
            l = min(px(b)[0] for b in boxes); t = min(px(b)[1] for b in boxes)
            r = max(px(b)[2] for b in boxes); bt = max(px(b)[3] for b in boxes)
            cx0 = max(0, int(l - M)); cy0 = max(0, int(t - M))
            cx1 = min(W, int(r + M)); cy1 = min(H, int(bt + M))
            cw, ch = cx1 - cx0, cy1 - cy0
            if cw < 4 or ch < 4:
                continue
            name = os.path.basename(ff)
            Image.open(ff).convert("RGB").crop((cx0, cy0, cx1, cy1)).save(os.path.join(indir, name))
            m = Image.new("L", (cw, ch), 0); d = ImageDraw.Draw(m)
            for b in boxes:
                bl, bt2, br, bb = px(b)
                d.rectangle([bl - cx0 - pad, bt2 - cy0 - pad, br - cx0 + pad, bb - cy0 + pad], fill=255)
            m.save(os.path.join(mskdir, name))
            offsets[name] = (cx0, cy0)
            sub_names.append(name)
        print(f"  자막 프레임 {len(sub_names)}개 인페인팅 대상(프레임별 crop)")

        # 4) crop 만 LaMa 인페인팅 → 원본 프레임의 crop 위치에 붙여넣기
        if sub_names:
            sh([IOPAINT, "run", "--model=lama", "--device=mps",
                f"--image={indir}", f"--mask={mskdir}", f"--output={outdir}"])
            for name in sub_names:
                op = os.path.join(outdir, name)
                if os.path.exists(op):
                    base = Image.open(os.path.join(frames, name)).convert("RGB")
                    base.paste(Image.open(op).convert("RGB"), offsets[name])
                    base.save(os.path.join(frames, name))

        # 5) 재조립(+원본 오디오)
        sh([FFMPEG, "-y", "-framerate", f"{fps}", "-i", os.path.join(frames, "%06d.png"),
            "-i", inp, "-map", "0:v", "-map", "1:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "copy", "-shortest", "-movflags", "+faststart", outp])
        print(f"OK → {outp}  (자막 {len(sub_names)}프레임 제거)")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
