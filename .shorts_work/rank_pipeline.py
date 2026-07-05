#!/usr/bin/env python3
"""랭킹 TOP5 포맷 전용 일괄 처리.
영상마다: 검정 헤더(제목) 영역 자동감지 → 제목 OCR → 해숏티 스타일 헤더로 재생성
(노랑 설명줄 + 흰 '랭킹 TOPn', 로고/워드마크 없음) + 하단 해숏티 배너.
좌우반전 없음, 영상/랭킹/자막 보존.

사용: python3 rank_pipeline.py <video.mp4 | 폴더> ...
출력: ../ranking_shorts/<원본파일명>
"""
import sys, os, re, glob, subprocess, tempfile, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SCENE_THR = 0.35   # 장면컷 감지 임계
MIN_SEG = 1.5      # 최소 세그먼트 길이(초) — 너무 잘게 쪼개지지 않게

WORK = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(WORK)
OUTDIR = os.path.join(ROOT, "ranking_shorts")          # 일반 변환 결과
SHUF_OUTDIR = os.path.join(ROOT, "ranking_shuffled")   # 셔플 변환 결과 (사용자 지시)
FONT = os.path.join(WORK, "BlackHanSans.ttf")
LOGO = os.path.join(WORK, "logo_circle.png")
RANK_LOGO = os.path.join(WORK, "rank_logo_circle.png")  # 랭킹굳 로고
BRAND = "랭킹굳"
OCR = os.path.join(WORK, "ocr")
W = 1080
YELLOW = (255, 212, 0, 255)
WHITE = (255, 255, 255, 255)
BG = (10, 10, 12, 255)
os.makedirs(OUTDIR, exist_ok=True)


def run(c): return subprocess.run(c, capture_output=True, text=True)
def Fn(s): return ImageFont.truetype(FONT, s)
def twpx(d, s, f):
    b = d.textbbox((0, 0), s, font=f); return b[2] - b[0]


def probe(v):
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", v])
    try:
        w, h = r.stdout.strip().split("x"); return int(w), int(h)
    except Exception:
        return 1080, 1920


def probe_dur(v):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", v])
    try:
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def has_audio(v):
    r = run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
             "stream=index", "-of", "csv=p=0", v])
    return bool(r.stdout.strip())


def scene_cuts(v):
    """장면 전환 시각(초) 목록."""
    r = run(["ffmpeg", "-i", v, "-filter:v", f"select='gt(scene,{SCENE_THR})',showinfo",
             "-f", "null", "-"])
    times = sorted(set(float(m) for m in re.findall(r"pts_time:([\d.]+)", r.stderr)))
    return times


def make_shuffled(v, tmp, n_target=0):
    """랭킹 항목(클립) 단위로 나눠 순서를 무작위로 재배치해 재결합.
    n_target(OCR로 얻은 TOP개수)에 맞춰 세그먼트 개수를 정확히 N개로 조정한다."""
    dur = probe_dur(v)
    cuts = [c for c in scene_cuts(v) if MIN_SEG < c < dur - MIN_SEG]
    # 최소 간격 보장(너무 가까운 컷 제거)
    bounds, last = [0.0], 0.0
    for c in cuts:
        if c - last >= MIN_SEG:
            bounds.append(c); last = c
    bounds.append(dur)
    segs = [[bounds[i], bounds[i + 1]] for i in range(len(bounds) - 1)]
    # OCR TOP개수에 맞춰 세그먼트 수 조정 (많으면 짧은 것 병합, 적으면 긴 것 분할)
    if n_target and n_target >= 2:
        while len(segs) > n_target:
            i = min(range(len(segs)), key=lambda k: segs[k][1] - segs[k][0])
            if i == 0:
                segs[0][1] = segs[1][1]; del segs[1]
            else:
                segs[i - 1][1] = segs[i][1]; del segs[i]
        while len(segs) < n_target and max(e - s for s, e in segs) > 2 * MIN_SEG:
            i = max(range(len(segs)), key=lambda k: segs[k][1] - segs[k][0])
            s, e = segs[i]; mid = (s + e) / 2
            segs[i:i + 1] = [[s, mid], [mid, e]]
    if len(segs) < 2:
        return v, 1  # 셔플 불가(단일 장면)
    order = list(range(len(segs)))
    random.shuffle(order)
    aud = has_audio(v)
    fc, labels = [], []
    for k, idx in enumerate(order):
        s, e = segs[idx]
        fc.append(f"[0:v]trim=start={s}:end={e},setpts=PTS-STARTPTS[v{k}]")
        if aud:
            fc.append(f"[0:a]atrim=start={s}:end={e},asetpts=PTS-STARTPTS[a{k}]")
            labels.append(f"[v{k}][a{k}]")
        else:
            labels.append(f"[v{k}]")
    n = len(order)
    fc.append("".join(labels) + f"concat=n={n}:v=1:a={1 if aud else 0}"
              + ("[v][a]" if aud else "[v]"))
    out = os.path.join(tmp, "shuf.mp4")
    cmd = ["ffmpeg", "-y", "-i", v, "-filter_complex", ";".join(fc), "-map", "[v]"]
    if aud:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-pix_fmt", "yuv420p", out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        return v, 1  # 실패 시 원본 사용
    return out, n


def title_from_filename(v):
    """원본 파일명에서 제목 추출(날짜접두·[영상ID] 제거). 랭킹 TOPn 이 온전해 OCR보다 신뢰도 높음."""
    b = os.path.splitext(os.path.basename(v))[0]
    b = re.sub(r"^\d{6,8}_", "", b)
    b = re.sub(r"\s*\[[^\]]+\]\s*$", "", b)
    return b.strip()


def sanitize(title):
    t = re.sub(r'[\\/:*?"<>|\n\r\t]+', " ", title or "")
    t = re.sub(r"\s+", " ", t).strip()
    return t[:100] or "video"


def unique_out(outdir, title):
    base = sanitize(title)
    p = os.path.join(outdir, base + ".mp4")
    i = 2
    while os.path.exists(p):
        p = os.path.join(outdir, f"{base}_{i}.mp4")
        i += 1
    return p


def detect_header(v, Wv, Hv, tmp):
    """움직임 기반: 가장 큰 연속 움직임 구간의 top = 검정 헤더 끝(영상 시작)."""
    run(["ffmpeg", "-y", "-i", v, "-vf", "fps=0.4", "-frames:v", "12",
         os.path.join(tmp, "d_%03d.png")])
    files = sorted(glob.glob(os.path.join(tmp, "d_*.png")))
    if len(files) < 3:
        return None
    grays = []
    for p in files:
        im = Image.open(p).convert("RGB")
        if im.size != (Wv, Hv):
            im = im.resize((Wv, Hv))
        grays.append(np.asarray(im, dtype=np.float32).mean(axis=2))
    st = np.stack(grays)
    rowvar = st.std(axis=0).mean(axis=1)
    thr = max(5.0, float(rowvar.max()) * 0.15)
    active = rowvar > thr
    idx = np.where(active)[0]
    if len(idx) == 0:
        return None
    # 작은 틈 메우고 가장 큰 연속 구간
    filled = np.zeros(Hv, bool); prev = idx[0]; filled[idx[0]] = True
    for k in idx[1:]:
        if k - prev <= 40:
            filled[prev:k + 1] = True
        else:
            filled[k] = True
        prev = k
    best = (0, 0); i = 0
    while i < Hv:
        if filled[i]:
            j = i
            while j < Hv and filled[j]:
                j += 1
            if j - i > best[0]:
                best = (j - i, i)
            i = j
        else:
            i += 1
    return best[1]  # videoTop = header bottom


def ocr_title(v, header_bottom, tmp):
    """헤더(0..header_bottom) 영역을 OCR 해 제목 텍스트 추출."""
    texts = []
    for t in (1.5, 4.0, 8.0):
        p = os.path.join(tmp, f"hdr_{int(t*10)}.png")
        run(["ffmpeg", "-y", "-ss", str(t), "-i", v, "-vf",
             f"crop={W}:{header_bottom}:0:0", "-frames:v", "1", p])
        if os.path.exists(p):
            r = run([OCR, p])
            line = r.stdout.split("\t", 1)
            if len(line) > 1:
                texts.append(re.sub(r"\s+", " ", line[1]).strip())
    texts = [t for t in texts if t]
    if not texts:
        return ""
    return max(texts, key=len)  # 가장 완전한 결과


def split_title(text):
    """제목을 [설명(노랑)] + [랭킹 TOPn(흰)] 으로 분리."""
    text = text.strip()
    m = re.search(r"랭킹", text)
    if not m:
        m = re.search(r"\bTOP", text, re.I)
    if m:
        return text[:m.start()].strip(), text[m.start():].strip()
    return text, ""


def fit_font(d, text, start, maxw, minsz=40):
    sz = start
    while sz > minsz and twpx(d, text, Fn(sz)) > maxw:
        sz -= 2
    return sz


def make_header(hb, desc, rank, tmp):
    img = Image.new("RGBA", (W, hb), BG)
    d = ImageDraw.Draw(img)
    maxw = int(W * 0.9)
    rank_sz = fit_font(d, rank or "랭킹 TOP5", 90, maxw)
    desc_sz = fit_font(d, desc or "랭킹", 84, maxw)
    gap = 16
    # 제목 블록을 헤더 하단쪽에 배치(아래로)
    y_rank = hb - 40 - rank_sz
    y_desc = y_rank - gap - desc_sz
    y_desc = max(int(hb * 0.18), y_desc)

    def ctext(y, txt, sz, fill):
        f = Fn(sz); w = twpx(d, txt, f)
        d.text(((W - w) // 2, y), txt, font=f, fill=fill)
    if desc:
        ctext(y_desc, desc, desc_sz, YELLOW)
    if rank:
        ctext(y_rank, rank, rank_sz, WHITE)
    if not desc and not rank:
        ctext(int(hb * 0.5), "랭킹 TOP5", rank_sz, WHITE)
    p = os.path.join(tmp, "header.png"); img.save(p)
    return p


def make_banner(tmp):
    BH = 168
    img = Image.new("RGBA", (W, BH), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 4], fill=YELLOW)
    bl = 112
    logo_src = RANK_LOGO if os.path.exists(RANK_LOGO) else LOGO
    logo = Image.open(logo_src).convert("RGBA").resize((bl, bl), Image.LANCZOS)
    f = Fn(52); tb = d.textbbox((0, 0), BRAND, font=f); tw = tb[2] - tb[0]
    gap = 18; total = bl + gap + tw; x0 = (W - total) // 2
    img.alpha_composite(logo, (x0, (BH - bl) // 2))
    d.text((x0 + bl + gap, (BH - (tb[3] - tb[1])) // 2 - 2), BRAND, font=f, fill=WHITE)
    p = os.path.join(tmp, "banner.png"); img.save(p)
    return p


def process(v, shuffle=False):
    Wv, Hv = probe(v)
    name = os.path.basename(v)
    with tempfile.TemporaryDirectory() as tmp:
        # 헤더/제목은 원본에서 감지·OCR (셔플해도 상단 검정 헤더는 정지라 동일)
        hb = detect_header(v, Wv, Hv, tmp)
        if not hb or hb < 300 or hb > 700:
            hb = 490  # 표준 랭킹 헤더(487/492)로 폴백
            print(f"  [{name}] 헤더 감지 보정 → 490")
        desc, rank = split_title(ocr_title(v, hb, tmp))
        # 파일명 제목이 'TOPn'을 온전히 담고 있으면 그것을 우선 사용(헤더·파일명 모두 깔끔).
        # OCR은 뒤에 잡음/오인식/'N탄' 누락이 잦아 신뢰도가 낮음.
        ft = title_from_filename(v)
        if re.search(r"TOP\s*\d", ft, re.I):
            desc, rank = split_title(ft)
        # 셔플: TOP개수(N)만큼 랭킹 항목(클립)으로 나눠 순서 섞기
        nseg = 0
        base = v
        if shuffle:
            m = re.search(r"TOP\s*(\d+)", rank, re.I)
            n_target = int(m.group(1)) if m else 0
            base, nseg = make_shuffled(v, tmp, n_target)
        header = make_header(hb, desc, rank, tmp)
        banner = make_banner(tmp)
        full_title = (desc + " " + rank).strip() or sanitize(name)
        outdir = SHUF_OUTDIR if shuffle else OUTDIR   # 셔플이면 ranking_shuffled/
        os.makedirs(outdir, exist_ok=True)
        out = unique_out(outdir, full_title)
        cmd = ["ffmpeg", "-y", "-i", base, "-i", header, "-i", banner,
               "-filter_complex", "[0:v][1:v]overlay=0:0[h];[h][2:v]overlay=0:H-h[v]",
               "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast",
               "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "copy",
               "-movflags", "+faststart", out]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"FAIL {name}: {r.stderr[-300:]}")
            return False
    tag = f" 셔플({nseg}조각)" if shuffle and nseg > 1 else (" 셔플불가" if shuffle else "")
    print(f"OK {name}{tag}  hb={hb}  제목='{desc}'|'{rank}'  → {os.path.basename(out)}")
    return True


def main():
    args = sys.argv[1:]
    shuffle = "--shuffle" in args
    args = [a for a in args if a != "--shuffle"]
    paths = []
    for a in args:
        if os.path.isdir(a):
            paths += sorted(glob.glob(os.path.join(a, "*.mp4")))
        else:
            paths.append(a)
    if not paths:
        print("입력 영상이 없습니다. 사용: python3 rank_pipeline.py [--shuffle] <영상|폴더>")
        return
    ok = 0
    for p in paths:
        if process(p, shuffle=shuffle):
            ok += 1
    print(f"\n완료: {ok}/{len(paths)}  -> {SHUF_OUTDIR if shuffle else OUTDIR}"
          + ("  (셔플 적용)" if shuffle else ""))


if __name__ == "__main__":
    main()
