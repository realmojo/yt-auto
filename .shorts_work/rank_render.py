#!/usr/bin/env python3
"""shuffle_data/<id>.json 기반으로 랭킹 숏폼을 '랜덤 셔플 + 랭킹굳 템플릿'으로 렌더한다.
- N개 구간을 랜덤 순서로 재배치
- 좌측 순위 목록을 새 재생 순서대로 재생성(기존 목록은 불투명 패널로 덮음)
- 랭킹굳 헤더(제목 재작성) + 하단 배너 적용 (rank_pipeline 재사용)
기하(행 위치)는 headerBottom + N 으로 유도(검출된 rows/footerTop 은 불안정하여 무시).
사용: python3 rank_render.py <id 또는 json경로> [--order ...] [--seed N] [--out PATH]
"""
import sys, os, re, json, random, subprocess, tempfile, argparse
from PIL import Image, ImageDraw, ImageFont

WORK = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(WORK)
sys.path.insert(0, WORK)
import rank_pipeline as rp  # detect_header, ocr_title, split_title, make_header, make_banner

FONT = os.path.join(WORK, "BlackHanSans.ttf")
DATA = os.path.join(WORK, "shuffle_data")
OUTDIR = os.path.join(ROOT, "ranking_shuffled")
os.makedirs(OUTDIR, exist_ok=True)

# 목록 기하(headerBottom 기준 상대) — 원본 TOP5(hb=487, row1=565, 간격105)로 보정
ROW_TOP_PAD = 78
ROWSPACE = 105
PANEL_X0, PANEL_X1 = 12, 636
OUTLINE = (8, 8, 10)
OUTLINE_W = 7
FONT_SIZE = 76


def palette(N):
    base = {1: (235, 35, 35), 2: (242, 132, 36), 3: (220, 184, 52)}
    cols = {}
    for r in range(1, N + 1):
        if r <= 3:
            cols[r] = base[r]
        else:
            t = (r - 3) / max(1, N - 3)
            g = int(208 - 58 * t)
            cols[r] = (g, g, g + 6)
    return cols


def row_centers(hb, N):
    return [hb + ROW_TOP_PAD + ROWSPACE * i for i in range(N)]


def detect_row_ys(v, hb, N, tmp):
    """좌측 목록의 행 세로중심 N개를 실측(영상마다 간격 다름).
    밴드가 noisy 하므로 'row1 위치 + 중앙값 간격'으로 등간격 모델을 맞춘다. 실패 시 None."""
    import numpy as np
    p = os.path.join(tmp, "rowdet.png")
    run(["ffmpeg", "-y", "-loglevel", "error", "-sseof", "-2.5", "-i", v, "-frames:v", "1", p])
    if not os.path.exists(p):
        return None
    im = Image.open(p).convert("RGB")
    if im.size[0] != 1080:
        im = im.resize((1080, im.size[1]))
    a = np.asarray(im, dtype=np.int16)
    H0 = a.shape[0]
    y0, y1 = hb, min(H0, hb + 900)
    reg = a[y0:y1, 30:300, :]
    if reg.size == 0:
        return None
    sat = (reg.max(2) - reg.min(2)) > 70
    white = reg.min(2) > 195
    score = (sat | white).mean(1)
    k = 9
    sm = np.convolve(score, np.ones(k) / k, mode="same")
    thr = max(0.05, float(sm.max()) * 0.35)
    active = sm > thr
    bands, i, n = [], 0, len(active)
    while i < n:
        if active[i]:
            j = i
            while j < n and active[j]:
                j += 1
            if j - i >= 20:
                bands.append(y0 + (i + j) // 2)  # center
            i = j
        else:
            i += 1
    # 정확히 N개 밴드가 잡힐 때만 신뢰(첫~끝을 N등분해 중간 noise 무시). 아니면 공식 fallback.
    if len(bands) != N:
        return None
    if not (hb + 30 <= bands[0] <= hb + 170):     # row1 은 헤더 바로 아래
        return None
    spacing = (bands[-1] - bands[0]) / (N - 1)
    if not (95 <= spacing <= 145):                  # 상식적 간격일 때만 신뢰(아니면 공식 fallback)
        return None
    return [int(bands[0] + spacing * i) for i in range(N)]


def make_list_overlay(ys, W, H, N, titles, revealed, current, path):
    """행마다 '글자 폭' 둥근 박스(pill)만 그린다(불투명, 새 텍스트 폭).
    반환: per-row 프로스트 사각형 목록 [(x,y,w,h)] — 원본 목록 글자를 그 줄 폭만큼만 가리기 위함."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cols = palette(N)
    f = ImageFont.truetype(FONT, FONT_SIZE)
    fc = ImageFont.truetype(FONT, FONT_SIZE + 6)
    sp = int((ys[-1] - ys[0]) / (N - 1)) if N > 1 else ROWSPACE
    x_text = 44
    pill_h = max(52, min(ROWSPACE - 16, sp - 12))
    fh = sp + 4
    cap_right = int(W * 0.72)
    ev = lambda x: max(0, int(x) // 2 * 2)
    rects = []
    for i, r in enumerate(range(1, N + 1)):
        cy = ys[i]
        is_cur = (r == current)
        fnt = fc if is_cur else f
        title = (titles.get(str(r), "") or "").strip()
        new_text = f"{r}. {title}" if (r in revealed and title) else f"{r}."
        # 원본 클립(rank=current)에서 이 줄은 k>=current 이면 제목이 있었다 → 그 폭까지만 가림
        orig_text = f"{r}. {title}" if (r >= current and title) else f"{r}."
        w_new = d.textlength(new_text, font=fnt)
        w_orig = d.textlength(orig_text, font=f)
        pill_right = min(cap_right, int(x_text + w_new + 30))
        frost_right = min(cap_right, int(x_text + max(w_new, w_orig) + 34))
        rects.append((ev(PANEL_X0), ev(cy - fh // 2), ev(frost_right - PANEL_X0), ev(fh)))
        d.rounded_rectangle([PANEL_X0, cy - pill_h // 2, pill_right, cy + pill_h // 2],
                            radius=24, fill=(12, 12, 16, 255))
        if is_cur:
            d.rounded_rectangle([PANEL_X0, cy - pill_h // 2 + 6, PANEL_X0 + 12,
                                 cy + pill_h // 2 - 6], radius=6, fill=cols[r] + (255,))
        d.text((x_text, cy), new_text, font=fnt, fill=cols[r] + (255,), anchor="lm",
               stroke_width=OUTLINE_W, stroke_fill=OUTLINE + (255,))
    img.save(path)
    return rects


def run(c):
    return subprocess.run(c, capture_output=True, text=True)


def clean_desc(desc):
    """헤더 설명에서 '(1번 제목 추천좀)' 등 시청자 공모/괄호 잡텍스트 제거."""
    desc = re.sub(r"\([^)]*\)", "", desc)
    desc = re.sub(r"\d+\s*번\s*제목\s*추천\s*좀?", "", desc)
    desc = re.sub(r"제목\s*추천\s*좀?", "", desc)
    return re.sub(r"\s+", " ", desc).strip()


def build_template(v, hb, tmp):
    """랭킹굳 헤더(제목 재작성) + 배너 PNG 생성."""
    title = rp.ocr_title(v, hb, tmp)
    desc, rank = rp.split_title(title)
    desc = clean_desc(desc)
    rank = re.sub(r"\([^)]*\)", "", rank).strip()  # '랭킹 TOP6 (다들...)' 괄호 CTA 제거
    header = rp.make_header(hb, desc, rank, tmp)
    banner = rp.make_banner(tmp)
    return header, banner


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="id 또는 shuffle_data/<id>.json 경로")
    ap.add_argument("--order")
    ap.add_argument("--seed", type=int)
    ap.add_argument("--out")
    ap.add_argument("--template", action="store_true", help="랭킹굳 헤더/배너 적용(기본 on)")
    ap.add_argument("--no-template", dest="template", action="store_false")
    ap.set_defaults(template=True)
    args = ap.parse_args()

    jp = args.target if args.target.endswith(".json") else os.path.join(DATA, f"{args.target}.json")
    if not os.path.exists(jp):
        print(f"JSON 없음: {jp}"); sys.exit(1)
    J = json.load(open(jp, encoding="utf-8"))
    v = J["video"]; W = J["W"]; H = J["H"]; hb = J["headerBottom"]
    N = J["N"]; dur = J["duration"]; titles = J["titles"]; segs = J["segments"]

    if args.order:
        order = [int(x) for x in re.split(r"[,\s]+", args.order.strip()) if x]
    else:
        if args.seed is not None:
            random.seed(args.seed)
        order = list(range(1, N + 1)); random.shuffle(order)
    assert sorted(order) == list(range(1, N + 1)), f"순서는 1~{N} 한 번씩: {order}"

    if args.out:
        out = args.out
    else:
        # 파일명: 제목.mp4 (날짜_·[id] 제거). 제목 중복 시 (2),(3)… 번호.
        title = re.sub(r"^\d{8}_", "", J["name"])
        title = re.sub(r"\s*\[[^\]]*\]\.mp4$", ".mp4", title)
        stem, ext = os.path.splitext(title)
        out = os.path.join(OUTDIR, title)
        k = 1
        while os.path.exists(out):
            k += 1
            out = os.path.join(OUTDIR, f"{stem} ({k}){ext}")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    print(f"입력: {J['name']}  N={N}  순서={order}")

    with tempfile.TemporaryDirectory() as tmp:
        header = banner = None
        if args.template:
            header, banner = build_template(v, hb, tmp)
        ys = detect_row_ys(v, hb, N, tmp) or row_centers(hb, N)
        seg_files = []
        revealed = set()
        for p, r in enumerate(order):
            revealed |= {r}
            s, e = segs[str(r)]
            if e is None:
                e = dur
            seg_dur = round(float(e) - float(s), 3)
            lp = os.path.join(tmp, f"list_{p}.png")
            rects = make_list_overlay(ys, W, H, N, titles, set(revealed), r, lp)
            seg_out = os.path.join(tmp, f"seg_{p}.mp4")

            # per-row 프로스트 체인: 각 행 사각형만 블러+어둡게(원본 글자 폭까지만) → 화면 대부분은 그대로 보임
            def frost_chain(src):
                parts, prev = [], src
                for k, (rx, ry, rw, rh) in enumerate(rects):
                    parts.append(
                        f"[{prev}]split[a{k}][z{k}];"
                        f"[z{k}]crop={rw}:{rh}:{rx}:{ry},boxblur=20:1,eq=brightness=-0.22:saturation=0.9[c{k}];"
                        f"[a{k}][c{k}]overlay={rx}:{ry}[q{k}];")
                    prev = f"q{k}"
                return "".join(parts), prev

            inputs = ["-ss", f"{s}", "-i", v, "-loop", "1", "-i", lp]
            fc = "[0:v]setpts=PTS-STARTPTS,fps=60[b];"
            if args.template:
                inputs += ["-loop", "1", "-i", header, "-loop", "1", "-i", banner]
                fc += "[b][2:v]overlay=0:0[h];[h][3:v]overlay=0:H-h[t];"
                chain, last = frost_chain("t")
            else:
                chain, last = frost_chain("b")
            fc += chain + f"[{last}][1:v]overlay=0:0:shortest=1[v]"
            cmd = ["ffmpeg", "-y", "-loglevel", "error", *inputs, "-t", f"{seg_dur}",
                   "-filter_complex", fc, "-map", "[v]", "-map", "0:a",
                   "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
                   "-af", "asetpts=PTS-STARTPTS", seg_out]
            rr = run(cmd)
            if rr.returncode != 0:
                print(f"FAIL seg {p} rank{r}: {rr.stderr[-400:]}"); sys.exit(1)
            seg_files.append(seg_out)
            print(f"  [{p+1}/{N}] rank{r} '{titles.get(str(r),'?')}' {s}-{e}s 공개={sorted(revealed)}")

        listf = os.path.join(tmp, "l.txt")
        open(listf, "w").write("".join(f"file '{s}'\n" for s in seg_files))
        rr = run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                  "-i", listf, "-c", "copy", "-movflags", "+faststart", out])
        if rr.returncode != 0:
            print(f"FAIL concat: {rr.stderr[-400:]}"); sys.exit(1)
    print(f"완료 → {out}")


if __name__ == "__main__":
    main()
