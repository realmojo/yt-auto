#!/usr/bin/env python3
"""shuffle_data/*.json 을 일괄 렌더(랜덤 셔플 + 랭킹굳 템플릿).
검증 통과한 JSON 만 렌더하고, 문제 있는 것은 이유와 함께 건너뛴다(무단 배치 방지).
사용:
  python3 rank_render_all.py            # 검증 통과분 전량 렌더
  python3 rank_render_all.py --report   # 렌더 없이 상태만 출력
  python3 rank_render_all.py --seed 7   # 재현 가능한 셔플
"""
import os, sys, glob, json, subprocess, argparse, re

WORK = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(WORK, "shuffle_data")


def problems(J):
    p = []
    N = J.get("N", 0)
    if not N or N < 3:
        p.append(f"N={N}")
        return p
    for r in range(1, N + 1):
        seg = J.get("segments", {}).get(str(r))
        if not seg or seg[0] is None or (r > 1 and seg[1] is None):
            p.append(f"{r}위 경계없음")
    for r in range(1, N + 1):
        t = (J.get("titles", {}).get(str(r)) or "").strip()
        placeholder = bool(re.search(r"제목\s*추천", t))
        if placeholder:
            continue   # '제목 추천좀' 은 이 채널의 정상 플레이스홀더(1위) — 허용
        if len(t) < 2 or "?" in t:
            p.append(f"{r}위 제목없음")
        elif len(t) > 9:
            p.append(f"{r}위 제목의심(길이 {len(t)})")   # OCR가 이웃 텍스트를 삼킨 경우
    # 경계 단조성(순위 N→1 시작이 증가해야) 위반 감지
    N = J.get("N", 0)
    starts = []
    for r in range(N, 0, -1):
        seg = J.get("segments", {}).get(str(r))
        if seg and seg[0] is not None:
            starts.append(seg[0])
    if starts != sorted(starts):
        p.append("경계 순서 이상")
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--seed", type=int)
    args = ap.parse_args()

    jsons = sorted(glob.glob(os.path.join(DATA, "*.json")))
    ready, skip = [], []
    for jp in jsons:
        try:
            J = json.load(open(jp, encoding="utf-8"))
        except Exception as e:
            skip.append((os.path.basename(jp), [f"JSON오류:{e}"])); continue
        pr = problems(J)
        (skip if pr else ready).append((jp, J, pr))

    print(f"총 {len(jsons)}개  |  렌더가능 {len(ready)}  |  교정필요 {len(skip)}")
    if skip:
        print("\n[교정 필요]")
        for item in skip:
            name = item[0] if len(item) == 2 else item[1].get("name", "?")
            reasons = item[-1]
            print(f"  - {name}: {', '.join(reasons)}")

    if args.report:
        return

    print("\n[렌더 시작]")
    ok = fail = 0
    for jp, J, _ in ready:
        cmd = ["python3", os.path.join(WORK, "rank_render.py"), jp]
        if args.seed is not None:
            cmd += ["--seed", str(args.seed)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            ok += 1
            print(f"  OK  {J['name']}")
        else:
            fail += 1
            print(f"  FAIL {J['name']}: {r.stdout.strip()[-160:]} {r.stderr.strip()[-160:]}")
    print(f"\n완료: 렌더 {ok}, 실패 {fail}, 교정필요 {len(skip)}  → ../ranking_shuffled/")


if __name__ == "__main__":
    main()
