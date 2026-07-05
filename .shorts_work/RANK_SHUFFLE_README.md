# 랭킹 숏폼 셔플 + 랭킹굳 템플릿 (반자동 파이프라인)

TOP N(3~8) 랭킹 영상의 순위 구간을 **랜덤 순서로 재배치**하고, 좌측 순위 목록을
새 순서에 맞게 **다시 그려**(기존 목록은 불투명 패널로 덮음) 랭킹굳 헤더/배너까지
입혀 출력한다.

## 3단계 흐름

### 1) 검출 (자동, 추측치 생성)
```bash
python3 rank_detect.py ../ranking_original        # 전체
python3 rank_detect.py "<영상.mp4>"               # 개별
```
- 출력: `shuffle_data/<id>.json` (N·구간경계·제목·밴드)
- 확인용: `shuffle_debug/<id>.png`(검출 시각화) + `shuffle_debug/<id>_sheet.png`(1fps 컨택트시트)
- **N(순위 개수)은 헤더로 안정 검출**. 경계·제목은 OCR 실패가 잦아 **사람 확인 필요**.

### 2) 교정 (사람, 경계·제목만)
`shuffle_data/<id>.json` 을 열어 `_sheet.png`(초 라벨)를 보며:
- `titles`: 비었거나 `?` 인 제목 채우기 (예: `"3": "마법 뜰채"`)
- `segments`: 각 순위 **시작 초**를 시트에서 읽어 보정.
  형식은 `"순위": [시작초, 끝초]`. 끝초는 다음(낮은) 순위 시작초와 같게.
  예) 5위가 0~3.1초, 4위가 3.1~10.9초 …
```json
"segments": {
  "5": [0.0, 3.1], "4": [3.1, 10.9], "3": [10.9, 18.3],
  "2": [18.3, 22.97], "1": [22.97, 28.14]
}
```
팁: 경계는 대개 **장면 전환(하드컷)** 과 일치. 시트에서 배경이 확 바뀌는 초를 고르면 됨.

### 3) 렌더 (자동, 전량)
```bash
python3 rank_render_all.py --report   # 렌더가능/교정필요 현황만
python3 rank_render_all.py            # 검증 통과분 전량 렌더
python3 rank_render.py <id>           # 개별 (예: --order 3,2,5,4,1 지정 가능)
```
- 출력: `../ranking_shuffled/<원본명>__shuf_<순서>.mp4`
- 검증(경계·제목 완비) 통과분만 렌더하고, 미비분은 이유와 함께 건너뜀 → 교정 후 재실행.

## 참고
- 목록 기하는 `headerBottom + N` 으로 유도(검출 rows 는 불안정하여 미사용).
  포맷이 많이 다른 영상은 `rank_render.py` 의 `ROW_TOP_PAD/ROWSPACE/FONT_SIZE` 조정.
- 스타일(색/폰트/패널): `rank_render.py` 의 `palette()`, `make_list_overlay()`.
- 랭킹굳 헤더/배너는 `rank_pipeline.py` 재사용(`--no-template` 로 끌 수 있음).
