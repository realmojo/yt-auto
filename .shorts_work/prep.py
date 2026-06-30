#!/usr/bin/env python3
"""영상 1개에서 레이아웃 경계 + 하단 자막(OCR) + 제목을 추출해 JSON 으로 저장.
사용: python3 prep.py "<video.mp4>"  → .shorts_work/data/<id>.json
"""
import sys, os, re, json, subprocess, tempfile, glob
import numpy as np
from PIL import Image

WORK = os.path.dirname(os.path.abspath(__file__))
OCR = os.path.join(WORK, "ocr")
DATA = os.path.join(WORK, "data")
os.makedirs(DATA, exist_ok=True)


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def probe_duration(v):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", v])
    try:
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def probe_dims(v):
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", v])
    try:
        w, h = r.stdout.strip().split("x")
        return int(w), int(h)
    except Exception:
        return 1080, 1920


def title_from_name(path):
    b = os.path.basename(path)
    b = re.sub(r"\.mp4$", "", b, flags=re.I)
    b = re.sub(r"^\d{8}_", "", b)              # 날짜 접두 제거
    b = re.sub(r"\s*\[[^\]]+\]\s*$", "", b)    # [id] 접미 제거
    return b.strip()


def vid_id(path):
    m = re.search(r"\[([^\]]+)\]", os.path.basename(path))
    return m.group(1) if m else re.sub(r"[^\w]+", "_", title_from_name(path))[:24]


def detect_bounds(v, W, H, tmp):
    """여러 프레임의 행별 흰색비율 중앙값으로 영상밴드(top,bottom) 추정."""
    patt = os.path.join(tmp, "bnd_%03d.png")
    run(["ffmpeg", "-y", "-i", v, "-vf", "fps=0.3", "-frames:v", "8", patt])
    fracs = []
    for p in sorted(glob.glob(os.path.join(tmp, "bnd_*.png"))):
        im = np.asarray(Image.open(p).convert("RGB"))
        if im.shape[0] != H:
            im = np.asarray(Image.open(p).convert("RGB").resize((W, H)))
        white = (im > 225).all(axis=2).mean(axis=1)
        fracs.append(white)
    if not fracs:
        return None
    med = np.median(np.stack(fracs), axis=0)
    nonwhite = np.where(med < 0.55)[0]
    if len(nonwhite) == 0:
        return None
    return int(nonwhite[0]), int(nonwhite[-1])


def ocr_captions(v, W, H, footer_top, tmp):
    crop_h = H - footer_top
    patt = os.path.join(tmp, "cap_%04d.png")
    run(["ffmpeg", "-y", "-i", v, "-vf",
         f"crop={W}:{crop_h}:0:{footer_top},fps=2", patt])
    files = sorted(glob.glob(os.path.join(tmp, "cap_*.png")))
    if not files:
        return []
    res = run([OCR] + files)
    texts = {}
    for line in res.stdout.splitlines():
        parts = line.split("\t")
        if not parts:
            continue
        fn = parts[0]
        txt = parts[1] if len(parts) > 1 else ""
        m = re.search(r"cap_(\d+)\.png", fn)
        if not m:
            continue
        idx = int(m.group(1))
        texts[idx] = re.sub(r"\s+", " ", txt).strip()
    # 인덱스순 → 연속 동일 묶기 (2fps → time=(idx-1)/2)
    segs = []
    for idx in sorted(texts):
        t = (idx - 1) * 0.5
        txt = texts[idx]
        if not txt:
            continue
        if segs and segs[-1]["text"] == txt:
            segs[-1]["end"] = round(t + 0.5, 2)
        else:
            segs.append({"start": round(t, 2), "end": round(t + 0.5, 2), "text": txt})
    return segs


def main():
    v = sys.argv[1]
    W, H = probe_dims(v)
    dur = probe_duration(v)
    with tempfile.TemporaryDirectory() as tmp:
        bounds = detect_bounds(v, W, H, tmp)
        if not bounds:
            print(json.dumps({"video": v, "error": "no_bounds"}))
            return
        vtop, vbot = bounds
        footer_top = vbot + 1
        segs = ocr_captions(v, W, H, footer_top, tmp)
    data = {
        "video": os.path.abspath(v),
        "filename": os.path.basename(v),
        "id": vid_id(v),
        "title": title_from_name(v),
        "W": W, "H": H, "duration": round(dur, 2),
        "headerBottom": vtop,      # 헤더(흰색) 끝 = 영상 시작 y
        "footerTop": footer_top,   # 자막영역 시작 y
        "segments": segs,          # OCR 원본 자막
    }
    out = os.path.join(DATA, data["id"] + ".json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"OK {data['id']}  header={vtop} footerTop={footer_top} segs={len(segs)}  -> {out}")


if __name__ == "__main__":
    main()
