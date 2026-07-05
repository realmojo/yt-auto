# 유튜브 쇼핑 쇼츠 — 레퍼런스 수집 (샤오홍수/RedNote)

이미지 + 키워드를 입력하면 샤오홍수(小红书)에서 해당 상품/키워드의 **영상 레퍼런스**를
검색·수집한다. 유튜브 쇼핑 쇼츠 제작 시 구성/편집/BGM/자막을 참고하기 위한 1단계 도구.

## 준비

```bash
# 최초 1회: 창이 뜨면 rednote.com 에 로그인(QR 스캔/문자 인증).
# 로그인을 끝낸 뒤 "터미널에서 Enter" 를 누르면, 새로고침해 로그인을 검증한 후
# 세션을 shopping/rednote-auth.json 에 저장한다.
node shopping/rednote-fetch.js --login
```

> ⚠️ 반드시 창에서 로그인을 **완료한 뒤** 터미널에서 Enter. 로그인 전에 Enter를 누르면
> "로그인이 확인되지 않았습니다" 로 저장을 거부한다(게스트 세션 저장 방지).
> 계정 세션은 `rednote.com` 도메인에 붙는다(로그인 후 rednote.com/explore 로 이동).

## 사용

```bash
# 검색 + 메타(제목/작성자/좋아요/썸네일/노트URL)만 수집
node shopping/rednote-fetch.js --keyword "电风扇" --limit 20

# 원본 영상까지 다운로드
node shopping/rednote-fetch.js --keyword "电风扇" --limit 12 --download

# 제작할 상품 이미지도 함께 보관
node shopping/rednote-fetch.js --keyword "户外风扇" --image ~/Desktop/fan.jpg --download

# 브라우저 창 보이게(디버깅)
node shopping/rednote-fetch.js --keyword "电风扇" --headful
```

npm 스크립트: `npm run rednote:login`, `npm run rednote -- --keyword "电风扇" --download`

## 옵션

| 플래그         | 설명                                             | 기본값 |
| -------------- | ------------------------------------------------ | ------ |
| `--keyword`    | 검색어(중국어 권장). 위치 인자로도 가능          | (필수) |
| `--limit`      | 수집할 노트 개수                                 | 20     |
| `--download`   | 각 노트를 열어 원본 mp4까지 다운로드             | off    |
| `--image`      | 제작할 상품 이미지 경로 → 결과 폴더에 복사       | 없음   |
| `--scrolls`    | 최대 스크롤 횟수                                 | 40     |
| `--headful`    | 브라우저 창 표시(기본 headless)                  | off    |
| `--login`      | 로그인 세션 저장 모드                            | -      |

## 결과물

```
shopping/refs/<키워드>/
  index.json          # 수집 메타(아래 필드)
  input.<ext>         # (--image 준 경우) 입력 상품 이미지
  videos/NN_<id>.mp4  # (--download 준 경우) 원본 영상
```

`index.json` 의 `notes[]` 각 항목:

| 필드        | 설명                                                     |
| ----------- | -------------------------------------------------------- |
| `id`        | 노트 ID                                                  |
| `url`       | 노트 URL(토큰 제외)                                      |
| `xsecUrl`   | `xsec_token` 포함 URL — 상세 진입/다운로드에 필요        |
| `title`     | 제목                                                     |
| `author`    | 작성자 이름                                              |
| `authorUrl` | 작성자 프로필 URL                                        |
| `time`      | 게시일(MM-DD)                                            |
| `likes`     | 좋아요 수                                                |
| `isVideo`   | 영상 여부(play 아이콘 감지)                              |
| `cover`     | 썸네일 이미지 URL                                        |
| `videoUrl`  | (--download) 원본 스트림 URL(rednotecdn.com/stream/…)    |
| `videoFile` | (--download) 저장된 로컬 경로(videos/NN_<id>.mp4)        |

---

# 2단계 — 레퍼런스 영상에 한국어 자막·내레이션 입히기

레퍼런스 상품 영상(또는 상품 이미지) + 키워드 → **세로 쇼츠(1080x1920)**.
레퍼런스 영상을 배경으로 재생하고 그 위에 **한국어 자막(흰색+검은 외곽선) + 내레이션(TTS)** 을 얹는다.
(영상이 없으면 상품 이미지 Ken Burns로 폴백)

```bash
# 영상 배경(기본): refs/<키워드>/videos/ 의 첫 영상을 자동 사용
node shopping/make-short.mjs --keyword "电风扇"

# 특정 레퍼런스 영상 지정
node shopping/make-short.mjs --keyword "电风扇" --video ~/Downloads/ref.mp4

# 이미지 방식(영상 대신 상품 이미지 Ken Burns)
node shopping/make-short.mjs --keyword "电风扇" --image ~/Desktop/fan.jpg

# 음성 변경 / 기존 대본 재사용 / 대본만
node shopping/make-short.mjs --keyword "电风扇" --voice Suhyun
node shopping/make-short.mjs --keyword "电风扇" --skip-script
node shopping/make-short.mjs --keyword "电风扇" --dry-script
```

npm: `npm run short -- --keyword "电风扇"`

**동작**
1. **배경 소스**: `--video` → `refs/<키워드>/videos/` 첫 영상(1단계 `--download`) → `--image`/`input.*` 순으로 선택.
   영상은 `source.mp4` 로 복사하고 장면 이해용 키프레임 5장을 추출.
2. **대본**: Claude(opus)가 (영상이면 키프레임들, 이미지면 상품 이미지) + 키워드 + `index.json` 레퍼런스 제목을
   근거로 한국어 대본 JSON 생성 → `refs/<키워드>/script.json`
   (`title`, `scenes[{narration, caption}]`, `cta`, `hashtags`). 영상이면 장면 흐름에 맞춰 내레이션 작성.
3. **내레이션**: 장면별 `say`(한국어 Yuna/…) → ffmpeg로 `narration.mp3` + 장면 타이밍.
4. **렌더**: Remotion `ShoppingShort` — 배경 영상(원음 음소거·반복) 위에 한국어 자막 + 타이틀/CTA + 내레이션 → `refs/<키워드>/short.mp4`.

**필요**: `ANTHROPIC_API_KEY`(`.env.local` 또는 `ant auth login`) · macOS `say` 한국어 음성 · ffmpeg · 시스템 Chrome.
API 키가 없으면 `script.json` 을 직접 작성하고 `--skip-script` 로 TTS·렌더만 돌릴 수 있다.

| 플래그         | 설명                                          | 기본값 |
| -------------- | --------------------------------------------- | ------ |
| `--keyword`    | 키워드(= refs 폴더). 위치 인자도 가능         | (필수) |
| `--video`      | 배경 레퍼런스 영상 경로                       | refs/<키워드>/videos/ 첫 영상 |
| `--image`      | 상품 이미지(영상 대신 Ken Burns)              | 없음   |
| `--voice`      | 한국어 say 음성(Yuna/Suhyun/Minsu/Jian)       | Yuna   |
| `--skip-script`| 기존 script.json 재사용                       | off    |
| `--dry-script` | 대본만 생성하고 종료                          | off    |
| `--fps`        | 프레임레이트                                  | 30     |

> 출력 길이는 내레이션 길이에 맞춘다(배경 영상은 그에 맞춰 반복/트림). 배경 영상의 원본 오디오는 음소거된다.

## 내레이션 음성 — macOS say vs Qwen3-TTS

macOS `say`(무료·기본)는 품질이 아쉽다. 자연스러운 한국어·보이스 클로닝은 **Qwen3-TTS(DashScope)** 를 쓴다.

```bash
# 1) 키 설정: .env.local 에 DASHSCOPE_API_KEY, DASHSCOPE_WORKSPACE_ID (국제판=싱가포르)
#    → 설정되면 make-short 가 자동으로 Qwen 사용 (강제: --tts qwen / say)

# 2) (선택) 내 목소리/원하는 목소리 클론: 10~20초 참조 오디오로 1회 등록
node shopping/qwen-tts.mjs --enroll ~/voice.mp3 --name myvoice
#    → voice_id 를 shopping/qwen-voice.json 에 저장, 이후 자동 사용

# 합성 테스트
node shopping/qwen-tts.mjs --say "이 제품, 지금 최저가로 만나보세요!" --out /tmp/o.wav

# 클론 없이 내장 음색만 쓰려면
node shopping/make-short.mjs --keyword "电风扇" --tts qwen --qwen-voice Cherry
```

- 클론이 등록돼 있으면 그 목소리로, 없으면 내장 음색(`--qwen-voice`, 기본 Cherry)으로 합성.
- 참조 오디오 권장: 10~20초, 모노, 24kHz↑, 또렷한 발화(<10MB).

## 주의

- 샤오홍수 웹 DOM은 자주 바뀝니다 → 셀렉터가 깨지면 `shopping/.rednote-debug/` 의
  스크린샷·HTML 덤프를 보고 `extractCards()` 셀렉터를 조정하세요.
- 검색 결과 열람에 로그인이 필요할 수 있습니다. 결과가 비면 `--login` 재실행.
- 크롤링은 서비스 약관상 회색지대입니다. 개인 리서치/레퍼런스 용도로만, 본인 책임하에.
