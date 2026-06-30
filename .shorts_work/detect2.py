#!/usr/bin/env python3
"""움직임(temporal variance) 기반으로 영상 밴드(top/bottom)를 robust하게 재감지.
헤더(로고+제목)·자막은 정지 → 변화 작음 / 영상은 움직임 → 변화 큼.
가장 큰 연속 '움직임 구간' = 영상 밴드.
사용: python3 detect2.py data/<id>.json [--apply]
"""
import sys, os, json, glob, subprocess, tempfile
import numpy as np
from PIL import Image


def run(c): return subprocess.run(c, capture_output=True, text=True)


def detect(v, W, H, tmp):
    patt = os.path.join(tmp, "d_%03d.png")
    run(["ffmpeg", "-y", "-i", v, "-vf", "fps=0.4", "-frames:v", "12", patt])
    files = sorted(glob.glob(os.path.join(tmp, "d_*.png")))
    if len(files) < 3:
        return None
    grays, whites = [], []
    for p in files:
        im = Image.open(p).convert("RGB")
        if im.size != (W, H):
            im = im.resize((W, H))
        a = np.asarray(im, dtype=np.float32)
        grays.append(a.mean(axis=2))
        whites.append((a > 225).all(axis=2).mean(axis=1))
    st = np.stack(grays)                       # (F,H,W)
    rowvar = st.std(axis=0).mean(axis=1)       # (H,) 행별 시간적 변화량
    medwhite = np.median(np.stack(whites), axis=0)
    # 움직이는 행: 변화 큼 AND 흰색배경 아님
    thr = max(5.0, float(rowvar.max()) * 0.15)
    active = (rowvar > thr) & (medwhite < 0.5)
    idx = np.where(active)[0]
    if len(idx) == 0:
        return None
    # 작은 틈(<=40px) 메워 연속 구간 만들기
    n = H
    filled = np.zeros(n, bool)
    prev = idx[0]; filled[idx[0]] = True
    for k in idx[1:]:
        if k - prev <= 40:
            filled[prev:k + 1] = True
        else:
            filled[k] = True
        prev = k
    # 가장 큰 연속 구간
    best = (0, 0, 0); i = 0
    while i < n:
        if filled[i]:
            j = i
            while j < n and filled[j]:
                j += 1
            if j - i > best[0]:
                best = (j - i, i, j - 1)
            i = j
        else:
            i += 1
    return best[1], best[2]


def main():
    jp = sys.argv[1]
    apply = "--apply" in sys.argv
    d = json.load(open(jp, encoding="utf-8"))
    W, H = d["W"], d["H"]
    with tempfile.TemporaryDirectory() as tmp:
        b = detect(d["video"], W, H, tmp)
    if not b:
        print(f"{d['id']}: FAIL detect"); return
    vtop, vbot = b
    new_hdr, new_ft = vtop, vbot + 1
    old_hdr, old_ft = d["headerBottom"], d["footerTop"]
    dh = new_hdr - old_hdr; df = new_ft - old_ft
    flag = "  <== 변경" if (abs(dh) > 15 or abs(df) > 15) else ""
    print(f"{d['id']}: header {old_hdr}->{new_hdr} ({dh:+d})  footerTop {old_ft}->{new_ft} ({df:+d}){flag}")
    if apply:
        d["headerBottom"] = int(new_hdr)
        d["footerTop"] = int(new_ft)
        json.dump(d, open(jp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
