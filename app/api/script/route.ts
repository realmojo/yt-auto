import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 스피치 진행 말투 (VOICE TONE) */
const TONES: Record<string, string> = {
  docu: "교양 다큐 톤 — EBS·내셔널지오그래픽 내레이션처럼 차분하고 깊이 있게. 신뢰감 있는 표준어, 절제된 감탄.",
  mystery:
    "미스터리 극화 톤 — 사건을 미스터리처럼 풀어가며 긴장감 유지. '그런데 이상한 점이 하나 있습니다' 같은 떡밥과 반전 구조 적극 사용.",
  casual:
    "유쾌 유튜버 톤 — 친근한 입담과 가벼운 유머. 시청자에게 말 걸듯 '여러분', '~거든요?' 같은 구어체. 과하지 않은 드립 허용.",
  analyst:
    "전문 분석가 톤 — 수치·근거 중심으로 차분하게 설득. '핵심은 세 가지입니다'처럼 구조화된 전달. 전문 용어는 한 줄 풀이 동반.",
  hyper:
    "몰입형 하이텐션 톤 — 빠른 호흡, 짧은 문장, 강한 강조. '진짜', '무려', '단 하루 만에' 같은 임팩트 어휘로 텐션 유지. 단, 허위 과장은 금지.",
};

/** 타겟 시청자층 */
const AUDIENCES: Record<string, string> = {
  general: "일반 대중 — 사전 지식 없는 시청자도 따라올 수 있게 쉬운 비유 사용",
  young: "2030 청년·직장인 — 내 월급·내 커리어와의 연결점을 강조, 트렌디한 표현 허용",
  middle: "4050 중장년 — 자산·노후·가족 관점의 실질적 영향 중심, 차분한 존댓말",
  senior: "60+ 시니어 — 천천히, 큰 맥락 위주로. 외래어는 풀어서 설명",
  invest: "투자·재테크 관심층 — 시장 영향, 수혜/피해 섹터, 리스크 요인을 구체적으로",
};

/** 희망 분량 */
const LENGTHS: Record<string, { chars: string; minutes: string }> = {
  "3": { chars: "900~1,300자", minutes: "3분 내외" },
  "8": { chars: "2,400~3,200자", minutes: "8분 내외" },
  "12": { chars: "3,800~4,800자", minutes: "12분 내외" },
};

const BASE_SYSTEM = `당신은 구독자 수십만 명의 한국어 유튜브 뉴스/이슈 채널 전속 롱폼 대본 작가입니다.
주어진 뉴스 기사 본문을 근거로, 시청자 유지율을 극대화하는 방송용 대본을 작성합니다.

절대 원칙:
1. 사실은 오직 제공된 기사 본문에서만 가져옵니다. 본문에 없는 수치·발언·일화를 지어내지 않습니다.
2. 배경 보충은 일반 상식 수준에서만, "~로 알려져 있습니다" 같은 비단정 표현으로.
3. 후킹은 강하게, 그러나 거짓 없이. 낚시성 허위 금지.
4. TTS로 바로 읽을 수 있는 자연스러운 구어체. 한 문장은 짧게.

반드시 아래 마크다운 구조를 그대로 따르세요:

## 🎬 제목 후보
1. (강력한 후킹형)
2. (검색 키워드형)
3. (호기심 자극형)

## 🖼️ 썸네일
- **메인 문구**: (7자 이내)
- **서브 문구**: (15자 이내)
- **이미지 컨셉**: (한 줄)

## 📝 대본

### ⚡ 오프닝 후킹 — 0:00~0:30
(첫 5초 안에 핵심 긴장을 던진다. "끝까지 봐야 하는 이유"를 심는다)

### 본문 섹션들
(### 소제목 형태로 2~4개 섹션. 사실 → 맥락 → "이게 왜 중요한가" 순.
 섹션 사이에 다음 내용 예고를 넣어 이탈을 막는다)

### 🏁 클로징
(3줄 핵심 요약 → 시청자에게 질문 → 구독 유도 한 문장)

## 🔖 설명란 & 해시태그
(2~3줄 설명, 해시태그 5개)

## ✅ 팩트 체크 노트
(대본에 사용한 핵심 사실 3~5개를 기사 원문 표현과 함께 — 편집자 검증용)`;

/** 자유 프롬프트(영상 주제) 기반 대본 — 기사-팩트 제약 없이 작성 */
const VIDEO_SYSTEM = `당신은 구독자 수십만 명의 한국어 유튜브 채널 전속 롱폼 대본 작가입니다.
사용자가 제시한 영상 주제·요청을 바탕으로, 시청자 유지율을 극대화하는 방송용 대본을 작성합니다.

원칙:
1. TTS로 바로 읽을 수 있는 자연스러운 구어체. 한 문장은 짧게.
2. 후킹은 강하게, 그러나 허위·과장은 금지. 확실치 않은 사실은 단정하지 않는다.
3. 사용자가 준 주제·핵심 메시지에서 벗어나지 않는다.

반드시 아래 마크다운 구조를 그대로 따르세요:

## 🎬 제목 후보
1. (강력한 후킹형)
2. (검색 키워드형)
3. (호기심 자극형)

## 🖼️ 썸네일
- **메인 문구**: (7자 이내)
- **서브 문구**: (15자 이내)
- **이미지 컨셉**: (한 줄)

## 📝 대본

대본 본문 작성 규칙(중요): 화자가 그대로 읽어 내려갈 순수 구어체 문장만 씁니다.
괄호 연출 지시( ), [B-Roll], "화자:"·"나레이션:" 같은 라벨, 문장을 통째로 감싸는 따옴표를 쓰지 마세요.
연출 메모가 필요하면 대본 본문에 섞지 말고 생략합니다.

### ⚡ 오프닝 후킹 — 0:00~0:30
첫 5초 안에 핵심 긴장이나 궁금증을 던지고, 끝까지 봐야 하는 이유를 심는 문장들.

### 본문
소제목(###) 2~4개로 나눠, 핵심 → 맥락 → 왜 중요한가 순서로. 섹션 사이에 다음 내용 예고로 이탈을 막는다.

### 🏁 클로징
3줄 핵심 요약, 시청자에게 던지는 질문, 구독 유도 한 문장.

## 🔖 설명란 & 해시태그
(2~3줄 설명, 해시태그 5개)`;

type ScriptRequest = {
  /** "article": 기사 기반(기본) · "prompt": 자유 영상 주제 기반 */
  mode?: "article" | "prompt";
  /** mode:"prompt" 일 때 영상 주제/요청 */
  prompt?: string;
  title?: string;
  press?: string;
  link?: string;
  summary?: string;
  body?: string;
  channel?: string;
  audience?: string;
  lengthMin?: string;
  tone?: string;
  broll?: boolean;
  cues?: boolean;
  highlight?: boolean;
  engine?: "ollama" | "claude";
};

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma3:latest";

/* thinking(추론 분리) 지원 모델만 think:true. gemma3 등 미지원 모델에 true면 Ollama가 400. */
const OLLAMA_THINK = process.env.OLLAMA_THINK
  ? process.env.OLLAMA_THINK === "true"
  : /qwen3|deepseek-r1|exaone-deep|magistral/i.test(OLLAMA_MODEL);

/* thinking 모델은 본문의 3~5배 토큰을 먼저 소모하므로 분량별로 충분히 */
const OLLAMA_PREDICT: Record<string, number> = {
  "3": 9000,
  "8": 13000,
  "12": 16000,
};

export async function POST(request: NextRequest) {
  let req: ScriptRequest;
  try {
    req = await request.json();
  } catch {
    return Response.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }
  const mode = req.mode ?? "article";
  if (mode === "article" && !req.title) {
    return Response.json({ error: "기사 제목이 필요합니다." }, { status: 400 });
  }
  if (mode === "prompt" && !req.prompt?.trim()) {
    return Response.json({ error: "대본 프롬프트를 입력하세요." }, { status: 400 });
  }

  const tone = TONES[req.tone ?? "docu"] ?? TONES.docu;
  const audience = AUDIENCES[req.audience ?? "general"] ?? AUDIENCES.general;
  const length = LENGTHS[req.lengthMin ?? "8"] ?? LENGTHS["8"];

  const directing: string[] = [];
  if (req.broll)
    directing.push(
      "각 섹션 시작과 장면 전환 지점에 [B-Roll: 구체적 화면 연출 안] 을 넣는다.",
    );
  if (req.cues)
    directing.push(
      "감정이 고조되는 지점에 (큐사인: 리액션/포즈/줌인 등) 연출 신호를 넣는다.",
    );
  if (req.highlight)
    directing.push(
      "시청자가 기억해야 할 핵심 문장 4~6개를 **굵게** 표시해 형광 자막 포인트로 명시한다.",
    );

  const system =
    (mode === "prompt" ? VIDEO_SYSTEM : BASE_SYSTEM) +
    (directing.length
      ? `\n\n연출 지시 (반드시 반영):\n${directing.map((d) => `- ${d}`).join("\n")}`
      : "");

  const userPrompt =
    mode === "prompt"
      ? [
          `## 작성 조건`,
          req.channel
            ? `- 채널 아이덴티티: ${req.channel} — 이 채널의 정체성에 맞는 관점과 어휘를 유지`
            : "",
          `- 타겟 시청자: ${audience}`,
          `- 스피치 말투: ${tone}`,
          `- 분량: 대본 본문 기준 ${length.chars} (영상 ${length.minutes})`,
          ``,
          `## 영상 주제 / 요청`,
          req.prompt,
        ]
          .filter(Boolean)
          .join("\n")
      : [
          `## 작성 조건`,
          req.channel
            ? `- 채널 아이덴티티: ${req.channel} — 이 채널의 정체성에 맞는 관점과 어휘를 유지`
            : "",
          `- 타겟 시청자: ${audience}`,
          `- 스피치 말투: ${tone}`,
          `- 분량: 대본 본문 기준 ${length.chars} (영상 ${length.minutes})`,
          ``,
          `## 기사 정보`,
          `제목: ${req.title}`,
          req.press ? `언론사: ${req.press}` : "",
          req.link ? `원문: ${req.link}` : "",
          ``,
          req.body
            ? `## 기사 본문 (사실의 유일한 근거)\n${req.body}`
            : `## 기사 요약 (본문 수집 실패 — 요약만 제공됨)\n${req.summary ?? "(없음)"}\n\n본문이 없으므로 구체적 수치 인용은 피하고, 제목과 요약 범위 안에서만 작성하세요.`,
        ]
          .filter(Boolean)
          .join("\n");

  const encoder = new TextEncoder();

  /* ───── Ollama (qwen3) 경로 ───── */
  if ((req.engine ?? "ollama") === "ollama") {
    let upstream: Response;
    try {
      upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
          stream: true,
          // thinking 지원 모델만 true (gemma3는 미지원 → false). think:true면 추론을 본문과 분리.
          think: OLLAMA_THINK,
          keep_alive: "15m",
          options: {
            // gemma3(소형)는 여유. 대형 모델 + 32GB RAM 대비 ctx 상한 보수적으로 유지
            num_ctx: 20480,
            num_predict: OLLAMA_PREDICT[req.lengthMin ?? "8"] ?? 10000,
            temperature: 0.7,
          },
        }),
        signal: request.signal,
      });
    } catch {
      return Response.json(
        {
          error: `Ollama 서버(${OLLAMA_URL})에 연결할 수 없습니다. 'ollama serve' 실행 여부를 확인하세요.`,
        },
        { status: 503 },
      );
    }
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      return Response.json(
        { error: `Ollama 오류 (HTTP ${upstream.status}): ${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const upstreamBody = upstream.body;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstreamBody.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const chunk = JSON.parse(line) as {
                  message?: { content?: string };
                  error?: string;
                  done?: boolean;
                };
                if (chunk.error) {
                  controller.enqueue(
                    encoder.encode(`\n\n> ⚠️ **Ollama 오류**: ${chunk.error}`),
                  );
                  break;
                }
                // thinking 델타는 버리고 본문(content)만 전달
                if (chunk.message?.content) {
                  controller.enqueue(encoder.encode(chunk.message.content));
                }
              } catch {
                /* 불완전한 JSON 라인은 무시 */
              }
            }
          }
        } catch {
          /* 클라이언트 중단 등 */
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  /* ───── Claude 경로 ───── */
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error:
          "ANTHROPIC_API_KEY가 설정되지 않았습니다. Ollama(qwen3) 엔진을 사용하거나 .env.local에 키를 설정하세요.",
      },
      { status: 503 },
    );
  }

  const client = new Anthropic();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const messageStream = client.messages.stream({
          model: "claude-opus-4-8",
          max_tokens: 64000,
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
          system,
          messages: [{ role: "user", content: userPrompt }],
        });

        messageStream.on("text", (delta) => {
          controller.enqueue(encoder.encode(delta));
        });

        await messageStream.finalMessage();
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "대본 생성 중 오류가 발생했습니다.";
        controller.enqueue(encoder.encode(`\n\n> ⚠️ **오류**: ${message}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
