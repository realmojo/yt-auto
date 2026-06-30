#!/usr/bin/env python3
"""JSON(제목+경계+자막)으로 해숏티 헤더 + 새 자막을 영상에 합성.
세그먼트의 'new'(패러프레이즈) 있으면 사용, 없으면 'text'(원본).
사용: python3 render.py data/<id>.json
출력: ../output_shorts/<원본파일명>
"""
import sys, os, re, json, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont

WORK = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(WORK)
OUTDIR = os.path.join(ROOT, "output_shorts")
FONT = os.path.join(WORK, "BlackHanSans.ttf")
LOGO = os.path.join(WORK, "logo_circle.png")
NAME = "해숏티"
os.makedirs(OUTDIR, exist_ok=True)


def font(sz):
    return ImageFont.truetype(FONT, sz)


def tw(draw, s, f):
    b = draw.textbbox((0, 0), s, font=f)
    return b[2] - b[0]


def wrap(draw, s, f, maxw):
    words, lines, cur = s.split(" "), [], ""
    for w in words:
        cand = w if cur == "" else cur + " " + w
        if tw(draw, cand, f) <= maxw or cur == "":
            cur = cand
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines


def make_header(W, hb, title, tmp):
    img = Image.new("RGBA", (W, hb), (255, 255, 255, 255))
    d = ImageDraw.Draw(img)
    L = min(160, int(hb * 0.30))
    logo = Image.open(LOGO).convert("RGBA").resize((L, L), Image.LANCZOS)
    logoY = int(hb * 0.10)
    img.alpha_composite(logo, (int((W - L) / 2), logoY))
    nf = font(max(30, int(hb * 0.085)))
    nw = tw(d, NAME, nf)
    nameY = logoY + L + int(hb * 0.015)
    d.text((int((W - nw) / 2), nameY), NAME, font=nf, fill=(17, 17, 17, 255))
    # 제목: 한 줄에 맞게 폰트 축소
    ts = 80
    while ts > 44:
        ft = font(ts)
        if tw(d, title, ft) <= W * 0.92:
            break
        ts -= 2
    ft = font(ts)
    titleY = hb - int(ts * 1.25) - 10
    titleY = max(nameY + nf.size + 6, titleY)
    twd = tw(d, title, ft)
    d.text((int((W - twd) / 2), titleY), title, font=ft, fill=(17, 17, 17, 255))
    p = os.path.join(tmp, "header.png")
    img.save(p)
    return p


def make_caption(W, text, tmp, idx):
    tmpd = ImageDraw.Draw(Image.new("RGBA", (4, 4)))
    sz = 56
    while sz >= 42:
        f = font(sz)
        lines = wrap(tmpd, text, f, int(W * 0.92))
        if len(lines) <= 2:
            break
        sz -= 2
    f = font(sz)
    lines = wrap(tmpd, text, f, int(W * 0.92))
    lineh = int(sz * 1.28)
    pad = 12
    H = lineh * len(lines) + pad * 2
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for j, ln in enumerate(lines):
        lw = tw(d, ln, f)
        d.text((int((W - lw) / 2), pad + j * lineh), ln, font=f, fill=(17, 17, 17, 255))
    p = os.path.join(tmp, f"cap_{idx:02d}.png")
    img.save(p)
    return p, H


def main():
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    v = data["video"]
    W, H = data["W"], data["H"]
    hb = data["headerBottom"]
    ft_top = data["footerTop"]
    dur = data.get("duration", 0)
    segs = data.get("segments", [])
    # 세그먼트 연속화(틈 제거): 각 end = 다음 start, 마지막 = duration
    segs = [dict(s) for s in segs if (s.get("new") or s.get("text"))]
    for i, s in enumerate(segs):
        s["end"] = segs[i + 1]["start"] if i + 1 < len(segs) else (dur or s["end"])

    out = os.path.join(OUTDIR, data["filename"])
    with tempfile.TemporaryDirectory() as tmp:
        header = make_header(W, hb, data["title"], tmp)
        cap_center = ft_top + int((H - ft_top) * 0.20)
        caps = []  # (path, y, start, end)
        for i, s in enumerate(segs):
            text = s.get("new") or s.get("text")
            p, ch = make_caption(W, text, tmp, i)
            y = max(ft_top + 6, int(cap_center - ch / 2))
            caps.append((p, y, s["start"], s["end"]))

        # ffmpeg 필터 — 영상은 좌우반전(hflip) 후, 헤더/자막은 정상방향으로 그 위에 덮음
        stmts = [f"[0:v]hflip,drawbox=x=0:y={ft_top}:w={W}:h={H - ft_top}:color=white:t=fill[b0]",
                 "[b0][1:v]overlay=0:0[h]"]
        prev = "h"
        for k, (_, y, a, b) in enumerate(caps):
            inp = k + 2
            o = "vout" if k == len(caps) - 1 else f"c{k}"
            stmts.append(f"[{prev}][{inp}:v]overlay=x=0:y={y}:enable='between(t,{a},{b})'[{o}]")
            prev = o
        if not caps:
            stmts[-1] = "[b0][1:v]overlay=0:0[vout]"
        filt = ";\n".join(stmts) + "\n"
        fpath = os.path.join(tmp, "filter.txt")
        open(fpath, "w", encoding="utf-8").write(filt)

        cmd = ["ffmpeg", "-y", "-i", v, "-i", header]
        for p, *_ in caps:
            cmd += ["-i", p]
        cmd += ["-filter_complex_script", fpath, "-map", "[vout]", "-map", "0:a?",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
                "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", out]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            sys.stderr.write(r.stderr[-1500:])
            print(f"FAIL {data['id']}")
            sys.exit(1)
    print(f"OK {data['id']} -> {out}")


if __name__ == "__main__":
    main()
