#!/usr/bin/env python3
"""랭킹 숏폼(TOP N, N=3~8) 자동 검출.
출력: shuffle_data/<id>.json  (N, 구간 경계, 순위별 제목, 목록 행좌표, 밴드)
      + shuffle_debug/<id>.png (검출 결과 시각화)
좌측 순위 목록을 시간축으로 OCR → 현재순위(제목이 표시된 최소 번호) 추적,
단조감소 제약 + 씬컷 스냅으로 구간 경계를 확정한다.
사용: python3 rank_detect.py <video|폴더> ...
"""
import sys, os, re, json, glob, subprocess, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont

WORK = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(WORK)
OCR = os.path.join(WORK, "ocr")
FONT = os.path.join(WORK, "BlackHanSans.ttf")
DATA = os.path.join(WORK, "shuffle_data")
DBG = os.path.join(WORK, "shuffle_debug")
os.makedirs(DATA, exist_ok=True)
os.makedirs(DBG, exist_ok=True)


def run(c):
    return subprocess.run(c, capture_output=True, text=True)


def probe(v):
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height",
             "-show_entries", "format=duration", "-of", "json", v])
    try:
        d = json.loads(r.stdout)
        w = d["streams"][0]["width"]; h = d["streams"][0]["height"]
        dur = float(d["format"]["duration"])
        return w, h, dur
    except Exception:
        return 1080, 1920, None


def detect_bands(v, W, H, tmp):
    """움직임(temporal variance) 기반 영상 밴드 = (headerBottom, footerTop)."""
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", v, "-vf", "fps=0.4",
         "-frames:v", "12", os.path.join(tmp, "b_%03d.png")])
    files = sorted(glob.glob(os.path.join(tmp, "b_*.png")))
    if len(files) < 3:
        return int(H * 0.25), int(H * 0.72)
    grays, whites = [], []
    for p in files:
        im = Image.open(p).convert("RGB")
        if im.size != (W, H):
            im = im.resize((W, H))
        a = np.asarray(im, dtype=np.float32)
        grays.append(a.mean(axis=2))
        whites.append((a > 225).all(axis=2).mean(axis=1))
    st = np.stack(grays)
    rowvar = st.std(axis=0).mean(axis=1)
    medwhite = np.median(np.stack(whites), axis=0)
    thr = max(5.0, float(rowvar.max()) * 0.15)
    active = (rowvar > thr) & (medwhite < 0.5)
    idx = np.where(active)[0]
    if len(idx) == 0:
        return int(H * 0.25), int(H * 0.72)
    filled = np.zeros(H, bool); prev = idx[0]; filled[idx[0]] = True
    for k in idx[1:]:
        if k - prev <= 40:
            filled[prev:k + 1] = True
        else:
            filled[k] = True
        prev = k
    best = (0, 0, 0); i = 0
    while i < H:
        if filled[i]:
            j = i
            while j < H and filled[j]:
                j += 1
            if j - i > best[0]:
                best = (j - i, i, j - 1)
            i = j
        else:
            i += 1
    return best[1], best[2] + 1


def scene_cuts(v):
    r = run(["ffmpeg", "-hide_banner", "-i", v, "-filter:v",
             "select='gt(scene,0.3)',showinfo", "-f", "null", "-"])
    ts = re.findall(r"pts_time:([0-9.]+)", r.stderr)
    return sorted(set(round(float(t), 3) for t in ts))


def ocr_img(p):
    r = run([OCR, p])
    line = r.stdout.split("\t", 1)
    return re.sub(r"\s+", " ", line[1]).strip() if len(line) > 1 else ""


def parse_ranked(txt):
    """'N. 한글제목' 패턴 → {N: title}. 번호 마커로 분리 후 각 구간의 선두 한글만."""
    out = {}
    toks = re.split(r"(?<!\d)([1-9])[.,]\s*", " " + txt)
    # toks = [pre, num, seg, num, seg, ...]
    for i in range(1, len(toks) - 1, 2):
        n = int(toks[i]); seg = toks[i + 1]
        m = re.match(r"\s*([가-힣][가-힣 ]{0,12})", seg)
        if not m:
            continue
        title = m.group(1).strip()
        if len(title) >= 2 and (n not in out or len(title) > len(out[n])):
            out[n] = title
    return out


def header_N(v, hb, tmp):
    """헤더의 '랭킹 TOP n' 을 OCR 해 N 을 얻는다(가장 신뢰도 높은 신호)."""
    best = 0
    for t in (1.5, 4.0, 8.0):
        p = os.path.join(tmp, f"h_{int(t*10)}.png")
        run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(t), "-i", v,
             "-vf", f"crop=iw:{hb}:0:0", "-frames:v", "1", p])
        if not os.path.exists(p):
            continue
        txt = ocr_img(p)
        m = re.search(r"TOP\s*([3-8])", txt, re.I)
        if m:
            best = max(best, int(m.group(1)))
    return best


def detect_rows(imP, hb, ft, N, W):
    """목록 텍스트 행 세로중심 N개 검출(공개 전량 프레임)."""
    im = Image.open(imP).convert("RGB")
    if im.size[0] != W:
        im = im.resize((W, im.size[1]))
    a = np.asarray(im, dtype=np.int16)
    x1 = int(W * 0.58)
    reg = a[hb:ft, 8:x1, :]
    if reg.size == 0:
        return []
    sat = (reg.max(axis=2) - reg.min(axis=2)) > 45
    bright = reg.min(axis=2) > 190
    score = (sat | bright).mean(axis=1)
    thr = max(0.03, score.max() * 0.28)
    active = score > thr
    bands = []
    i = 0; n = len(active)
    while i < n:
        if active[i]:
            j = i
            while j < n and active[j]:
                j += 1
            if j - i >= 12:
                bands.append((hb + i, hb + j))
            i = j
        else:
            i += 1
    centers = [ (s + e) // 2 for s, e in bands ]
    heights = [ e - s for s, e in bands ]
    return centers, heights


def detect(v):
    W, H, dur = probe(v)
    name = os.path.basename(v)
    vid = re.search(r"\[([^\]]+)\]", name)
    vid = vid.group(1) if vid else os.path.splitext(name)[0]
    warns = []
    with tempfile.TemporaryDirectory() as tmp:
        hb, ft = detect_bands(v, W, H, tmp)
        if not (0.10 * H < hb < 0.45 * H):
            warns.append(f"headerBottom 의심({hb})")
        cuts = scene_cuts(v)
        hN = header_N(v, hb, tmp)
        # 시간축 OCR — 한 번의 fps 패스로 좌측영역 프레임을 일괄 추출(개별 seek 대비 대폭 가속)
        end = dur if dur else 30.0
        FPS = 2.0  # 0.5s 간격
        crop_h = min(int(ft - hb), 900)
        odir = os.path.join(tmp, "ocrf"); os.makedirs(odir, exist_ok=True)
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", v, "-vf",
             f"crop={int(W*0.60)}:{crop_h}:0:{hb},fps={FPS}",
             os.path.join(odir, "f_%04d.png")])
        frames = sorted(glob.glob(os.path.join(odir, "f_*.png")))
        times_by_rank = {}
        titles = {}
        last_full = ""
        for k, p in enumerate(frames):
            t = round(k / FPS, 2)
            txt = ocr_img(p)
            ranked = parse_ranked(txt)
            if ranked:
                cur = min(ranked)
                times_by_rank.setdefault(cur, []).append(t)
                for n, ti in ranked.items():
                    if n not in titles or len(ti) > len(titles[n]):
                        titles[n] = ti
                if len(txt) > len(last_full):
                    last_full = txt
        list_max = max(times_by_rank) if times_by_rank else 0
        N = hN or list_max
        if not N:
            warns.append("N 미검출(헤더/목록 모두 실패)")
        elif hN and list_max and hN != list_max:
            warns.append(f"N 불일치: 헤더={hN} 목록={list_max}")
        # 단조감소로 구간 시작 확정
        starts = {}
        if N:
            starts[N] = 0.0
            last = 0.0
            for r in range(N - 1, 0, -1):
                cand = [x for x in times_by_rank.get(r, []) if x > last + 0.3]
                if not cand:
                    warns.append(f"rank {r} 경계 미검출")
                    starts[r] = None
                    continue
                st = min(cand)
                # 씬컷 스냅(±1.5s)
                near = [c for c in cuts if abs(c - st) <= 1.5]
                if near:
                    st = min(near, key=lambda c: abs(c - st))
                starts[r] = round(st, 3)
                last = st
        # 행좌표
        rows, rheights = [], []
        if N and last_full:
            # 전량 공개에 가까운 프레임(가장 늦은 rank1 시점) 추출
            tf = (starts.get(1) or (end - 1)) + 0.6
            pf = os.path.join(tmp, "endf.png")
            run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{min(tf, end-0.2)}",
                 "-i", v, "-frames:v", "1", pf])
            res = detect_rows(pf, hb, ft, N, W)
            if res:
                rows, rheights = res
            # 디버그 이미지
            dbg = Image.open(pf).convert("RGB")
            d = ImageDraw.Draw(dbg)
            try:
                f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 34)
            except Exception:
                f = ImageFont.load_default()
            d.line([(0, hb), (W, hb)], fill=(0, 255, 0), width=3)
            d.line([(0, ft), (W, ft)], fill=(255, 0, 255), width=3)
            for cy in rows:
                d.line([(0, cy), (W, cy)], fill=(0, 200, 255), width=2)
            summ = f"N={N} rows={len(rows)}"
            d.text((20, hb + 6), summ, fill=(0, 255, 0), font=f)
            info = []
            for r in range(N, 0, -1):
                s = starts.get(r)
                info.append(f"{r}:{titles.get(r,'?')} @{s}")
            d.multiline_text((20, ft + 10), "\n".join(info), fill=(255, 255, 0), font=f)
            dbg.save(os.path.join(DBG, f"{vid}.png"))
            # 교정용 1fps 컨택트시트(초 라벨) — 경계·제목 눈으로 확인용
            cols_n = 7
            rows_n = int((end // 1) // cols_n) + 1
            run(["ffmpeg", "-y", "-loglevel", "error", "-i", v, "-vf",
                 f"fps=1,scale=180:320,drawtext=text='%{{n}}s':x=3:y=3:fontsize=20:"
                 f"fontcolor=yellow:box=1:boxcolor=black@0.6,tile={cols_n}x{rows_n}",
                 "-frames:v", "1", os.path.join(DBG, f"{vid}_sheet.png")])

    # 구간 dict
    segs = {}
    if N:
        for r in range(N, 0, -1):
            s = starts.get(r)
            if s is None:
                continue
            e = starts.get(r - 1) if r > 1 else dur
            segs[r] = [s, e]
    # 검증
    ok = (N >= 3 and len([r for r in range(1, N + 1) if r in segs]) == N
          and all(r in titles for r in range(1, N + 1))
          and len(rows) == N)
    out = {
        "video": os.path.abspath(v), "id": vid, "name": name,
        "W": W, "H": H, "duration": dur,
        "headerBottom": int(hb), "footerTop": int(ft),
        "N": N, "titles": {str(k): titles.get(k, "") for k in range(1, N + 1)},
        "segments": {str(k): segs.get(k) for k in range(1, N + 1)},
        "rows": rows, "rowHeights": rheights,
        "ok": bool(ok), "warnings": warns,
    }
    json.dump(out, open(os.path.join(DATA, f"{vid}.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    status = "OK " if ok else "CHK"
    print(f"[{status}] N={N} rows={len(rows)} segs={sorted(segs)} "
          f"titles={[titles.get(r,'?') for r in range(1,(N or 0)+1)]} "
          f"{'| '+';'.join(warns) if warns else ''}  {name}")
    return out


def main():
    paths = []
    for a in sys.argv[1:]:
        if os.path.isdir(a):
            paths += sorted(glob.glob(os.path.join(a, "*.mp4")))
        else:
            paths.append(a)
    for p in paths:
        try:
            detect(p)
        except Exception as e:
            print(f"FAIL {os.path.basename(p)}: {e}")


if __name__ == "__main__":
    main()
