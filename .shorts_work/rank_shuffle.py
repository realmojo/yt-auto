#!/usr/bin/env python3
"""랭킹 TOP5 영상의 5개 구간을 랜덤 순서로 섞어 재조합한다.
왼쪽 순위 목록이 영상에 박혀(baked-in) 있고 카운트다운으로 누적 공개되므로,
구간만 섞으면 목록이 어긋난다. → 각 구간마다 '새 재생 순서'에 맞춰 목록을
다시 그려(기존 텍스트는 어두운 pill 로 덮음) 일관성을 유지한다.

사용:
  python3 rank_shuffle.py [video.mp4] [--order 3,2,5,4,1] [--seed 7] [--out PATH]
기본: 이 채널 포맷(28s, 1080x1920) 1개 영상, 무작위 순서.
"""
import sys, os, re, json, random, subprocess, tempfile, argparse
from PIL import Image, ImageDraw, ImageFont

WORK = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(WORK)
FONT_PATH = os.path.join(WORK, "BlackHanSans.ttf")

DEFAULT_VIDEO = os.path.join(
    ROOT, "ranking_original",
    "20260212_역대급 신기한 물리 랭킹 TOP5 [ILWyr4CzGL8].mp4")

W, H = 1080, 1920

# 순위별 구간 [start, end] (초). end=None → 영상 끝까지. 씬 검출로 확정한 경계.
SEGMENTS = {
    5: (0.0, 3.10),
    4: (3.10, 10.90),
    3: (10.90, 18.30),
    2: (18.30, 22.97),
    1: (22.97, None),
}
TITLES = {1: "중력 무시", 2: "얼음물", 3: "마법 뜰채", 4: "변덕쟁이", 5: "맞으면 사망"}
# 순위별 글자색 (원본 팔레트: 1 빨강 → 5 회색)
PALETTE = {
    1: (235, 35, 35),
    2: (242, 132, 36),
    3: (220, 184, 52),
    4: (205, 205, 210),
    5: (236, 236, 242),
}
ROW_Y = {1: 565, 2: 670, 3: 775, 4: 880, 5: 985}  # 각 행 세로 중심
X_NUM = 42            # 번호 시작 x
FONT_SIZE = 80
OUTLINE = (8, 8, 10)  # 글자 외곽선(검정)
OUTLINE_W = 7
PILL_X0, PILL_X1 = 14, 624   # 기존 목록 텍스트를 덮는 pill 가로 범위
PILL_H = 96
PILL_FILL = (12, 12, 14, 255)  # 불투명 — 기존(박힌) 텍스트를 완전히 가린다(잔상 방지)


def ffprobe_dur(v):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", v],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except Exception:
        return None


def make_overlay(revealed, current, path):
    """revealed: 제목을 표시할 순위 집합. current: 현재 재생 중 순위(강조).
    1080x1920 투명 PNG 생성 — 5행 모두 그리되, 미공개 행은 번호만."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    font_cur = ImageFont.truetype(FONT_PATH, FONT_SIZE + 6)
    for k in range(1, 6):
        cy = ROW_Y[k]
        # 1) 기존(박힌) 텍스트를 덮는 어두운 pill
        d.rounded_rectangle([PILL_X0, cy - PILL_H // 2, PILL_X1, cy + PILL_H // 2],
                            radius=26, fill=PILL_FILL)
        # 2) 현재 행은 좌측 악센트 바
        if k == current:
            d.rounded_rectangle([PILL_X0, cy - PILL_H // 2, PILL_X0 + 12, cy + PILL_H // 2],
                                radius=6, fill=PALETTE[k] + (255,))
        # 3) 텍스트(번호 항상, 제목은 공개된 경우만)
        is_cur = (k == current)
        f = font_cur if is_cur else font
        text = f"{k}. {TITLES[k]}" if k in revealed else f"{k}."
        col = PALETTE[k] + (255,)
        d.text((X_NUM, cy), text, font=f, fill=col, anchor="lm",
               stroke_width=OUTLINE_W, stroke_fill=OUTLINE + (255,))
    img.save(path)


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video", nargs="?", default=DEFAULT_VIDEO)
    ap.add_argument("--order", help="예: 3,2,5,4,1 (생략 시 무작위)")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    video = args.video
    if not os.path.exists(video):
        print(f"파일 없음: {video}"); sys.exit(1)

    dur = ffprobe_dur(video)
    if args.order:
        order = [int(x) for x in re.split(r"[,\s]+", args.order.strip()) if x]
    else:
        if args.seed is not None:
            random.seed(args.seed)
        order = [5, 4, 3, 2, 1]
        random.shuffle(order)
    assert sorted(order) == [1, 2, 3, 4, 5], f"순서는 1~5 한 번씩: {order}"

    out = args.out or os.path.join(
        ROOT, "ranking_shuffled",
        os.path.splitext(os.path.basename(video))[0] +
        f"__shuf_{''.join(map(str, order))}.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    print(f"입력: {os.path.basename(video)}  (dur={dur:.2f}s)")
    print(f"새 재생 순서: {order}")

    with tempfile.TemporaryDirectory() as tmp:
        seg_files = []
        revealed = set()
        for p, rank in enumerate(order):
            revealed = revealed | {rank}
            ov = os.path.join(tmp, f"ov_{p}.png")
            make_overlay(revealed, rank, ov)
            start, end = SEGMENTS[rank]
            if end is None:
                end = dur
            seg_dur = round(end - start, 3)
            seg_out = os.path.join(tmp, f"seg_{p}.mp4")
            cmd = ["ffmpeg", "-y", "-loglevel", "error",
                   "-ss", f"{start}", "-i", video,
                   "-loop", "1", "-i", ov,
                   "-t", f"{seg_dur}",
                   "-filter_complex",
                   "[0:v]setpts=PTS-STARTPTS,fps=60[v0];"
                   "[v0][1:v]overlay=0:0:shortest=1[v]",
                   "-map", "[v]", "-map", "0:a",
                   "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                   "-pix_fmt", "yuv420p",
                   "-c:a", "aac", "-b:a", "160k", "-ar", "44100",
                   "-af", "asetpts=PTS-STARTPTS",
                   seg_out]
            r = run(cmd)
            if r.returncode != 0:
                print(f"FAIL seg {p} (rank {rank}): {r.stderr[-400:]}"); sys.exit(1)
            seg_files.append(seg_out)
            print(f"  [{p+1}/5] rank {rank} '{TITLES[rank]}'  {start:.2f}-{end:.2f}s "
                  f"공개={sorted(revealed)}")

        listf = os.path.join(tmp, "list.txt")
        with open(listf, "w") as f:
            for s in seg_files:
                f.write(f"file '{s}'\n")
        r = run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                 "-i", listf, "-c", "copy", "-movflags", "+faststart", out])
        if r.returncode != 0:
            print(f"FAIL concat: {r.stderr[-400:]}"); sys.exit(1)

    print(f"\n완료 → {out}")


if __name__ == "__main__":
    main()
