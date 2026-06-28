"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Check,
  Clapperboard,
  Clock3,
  Copy,
  ExternalLink,
  Flame,
  Info,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Square,
} from "lucide-react";

import { CATEGORIES, type NewsItem } from "@/lib/naver-news";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

const DEFAULT_COUNT = 100;

/* 카테고리 영문 라벨 (카드 뱃지용) */
const CAT_EN: Record<string, string> = {
  "100": "POLITICS",
  "101": "ECONOMY",
  "102": "SOCIETY",
  "103": "CULTURE",
  "104": "WORLD",
  "105": "TECH",
};

const AUDIENCE_OPTIONS = [
  { value: "general", label: "일반 대중 시청자층" },
  { value: "young", label: "2030 청년·직장인" },
  { value: "middle", label: "4050 중장년" },
  { value: "senior", label: "60+ 시니어" },
  { value: "invest", label: "투자·재테크 관심층" },
];

const LENGTH_OPTIONS = [
  { value: "3", label: "3분 내외" },
  { value: "8", label: "8분 내외" },
  { value: "12", label: "12분 내외" },
];

const TONE_OPTIONS = [
  { value: "docu", label: "교양 다큐 톤" },
  { value: "mystery", label: "미스터리 극화 톤" },
  { value: "casual", label: "유쾌 유튜버 톤" },
  { value: "analyst", label: "전문 분석가 톤" },
  { value: "hyper", label: "몰입형 하이텐션" },
];

type ArticleBody = {
  status: "idle" | "loading" | "ok" | "fail";
  text: string | null;
};

export default function Page() {
  const [sid, setSid] = useState<string>(CATEGORIES[0].sid);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<NewsItem | null>(null);
  const [body, setBody] = useState<ArticleBody>({ status: "idle", text: null });

  /* 스펙 */
  const [engine, setEngine] = useState<"ollama" | "claude">("ollama");
  const [channel, setChannel] = useState("시사 및 지식 탐구 매거진 채널");
  const [audience, setAudience] = useState("general");
  const [lengthMin, setLengthMin] = useState("8");
  const [tone, setTone] = useState("docu");
  const [broll, setBroll] = useState(true);
  const [cues, setCues] = useState(true);
  const [highlight, setHighlight] = useState(true);

  /* 생성 */
  const [script, setScript] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const loadNews = useCallback(async (category: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/news?count=${DEFAULT_COUNT}&sid=${category}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as
        | { ok: true; items: NewsItem[] }
        | { ok: false; error: string };
      if (!data.ok) throw new Error(data.error);
      setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNews(sid);
  }, [sid, loadNews]);

  /* 기사 선택 → 본문 크롤링 */
  useEffect(() => {
    setScript("");
    setGenErr(null);
    if (!selected) {
      setBody({ status: "idle", text: null });
      return;
    }
    let cancelled = false;
    setBody({ status: "loading", text: null });
    fetch(`/api/article?url=${encodeURIComponent(selected.link)}`)
      .then((r) => r.json())
      .then((d: { ok: boolean; body?: string }) => {
        if (cancelled) return;
        if (d.ok && d.body) setBody({ status: "ok", text: d.body });
        else setBody({ status: "fail", text: null });
      })
      .catch(() => !cancelled && setBody({ status: "fail", text: null }));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  /* 스트리밍 자동 스크롤 */
  useEffect(() => {
    if (generating && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [script, generating]);

  /* 생성 완료된 대본을 편집기 자막 가져오기에 전달 */
  useEffect(() => {
    if (!generating && script) {
      try {
        localStorage.setItem("yt-auto:script", script);
      } catch {
        /* noop */
      }
    }
  }, [generating, script]);

  const generate = useCallback(async () => {
    if (!selected) return;
    setGenerating(true);
    setGenErr(null);
    setScript("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selected.title,
          summary: selected.summary,
          press: selected.press,
          link: selected.link,
          body: body.text ?? undefined,
          channel,
          audience,
          lengthMin,
          tone,
          broll,
          cues,
          highlight,
          engine,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || `요청 실패 (${res.status})`,
        );
      }
      if (!res.body) throw new Error("스트림 응답이 없습니다.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setScript((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setGenErr(e instanceof Error ? e.message : "대본 생성 실패");
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [selected, body.text, channel, audience, lengthMin, tone, broll, cues, highlight, engine]);

  const stop = () => abortRef.current?.abort();
  const copy = async () => {
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.press.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <div className="flex h-svh flex-col bg-[#04060e] text-slate-200">
      {/* ════ TOP BAR ════ */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#141b2e] px-5">
        <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 text-sm font-black text-white shadow-[0_0_18px_rgba(79,90,245,0.5)]">
          YT
        </div>
        <div className="leading-tight">
          <h1 className="text-[15px] font-bold tracking-tight">
            ScriptAI Pro <span className="text-indigo-400">Studio V2</span>
          </h1>
          <p className="text-[11px] text-slate-500">
            네이버 실시간 뉴스 기반 크리에이터 대본 워크스페이스
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/editor"
            className="flex items-center gap-1.5 rounded-md bg-gradient-to-r from-indigo-500 to-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-[0_0_14px_rgba(79,90,245,0.4)] transition hover:brightness-110"
          >
            <Clapperboard className="size-3.5" /> 영상 편집기
          </Link>
          <span className="rounded-md border border-indigo-500/60 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300">
            대본 워크스페이스
          </span>
          <span className="hidden px-3 py-1.5 text-xs text-slate-400 lg:inline">
            플랫폼 활용 노하우
          </span>
          <span className="ml-2 flex items-center gap-1.5 rounded-md border border-[#1d2845] bg-[#0a101f] px-2.5 py-1.5 text-[11px] font-semibold tracking-wide text-emerald-400">
            <span className="live-dot inline-block size-1.5 rounded-full bg-emerald-400" />
            AI CORE ONLINE
          </span>
        </div>
      </header>

      {/* ════ MAIN ════ */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,380px)_minmax(0,1fr)] gap-4 p-4">
        {/* ── ① NEWS FEED ── */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#161e33] bg-[#070b16]">
          <div className="shrink-0 space-y-3 border-b border-[#141b2e] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-emerald-500 px-2 py-0.5 text-[10px] font-black tracking-wider text-emerald-950">
                  NAVER NEWS
                </span>
                <div className="leading-tight">
                  <p className="text-[13px] font-bold">실시간 최신 속보</p>
                  <p className="text-[10px] text-slate-500">
                    연동 출처: 네이버 뉴스 섹션
                  </p>
                </div>
              </div>
              <button
                onClick={() => loadNews(sid)}
                disabled={loading}
                title="새로고침"
                className="flex size-8 items-center justify-center rounded-lg border border-[#1d2845] bg-[#0a101f] text-slate-400 transition hover:text-indigo-300 disabled:opacity-50"
              >
                <RefreshCw
                  className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                />
              </button>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="핵심 키워드 혹은 속보 검색..."
                  className="h-9 w-full rounded-lg border border-[#1d2845] bg-[#0a101f] pl-8 pr-2 text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/60 focus:outline-none"
                />
              </div>
              <button
                onClick={() => loadNews(sid)}
                disabled={loading}
                className="h-9 shrink-0 rounded-lg border border-[#1d2845] bg-[#0d1322] px-3 text-[11px] font-semibold text-slate-400 transition hover:text-indigo-300 disabled:opacity-50"
              >
                기사 정밀서치
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.sid}
                  onClick={() => setSid(c.sid)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                    sid === c.sid
                      ? "bg-indigo-600 text-white shadow-[0_0_12px_rgba(79,90,245,0.4)]"
                      : "border border-[#1d2845] bg-[#0a101f] text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2.5 p-3">
              {error && (
                <p className="px-2 py-4 text-sm text-red-400">
                  불러오기 실패: {error}
                </p>
              )}
              {loading ? (
                <FeedSkeleton />
              ) : filtered.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  검색 결과가 없습니다.
                </p>
              ) : (
                filtered.map((item) => (
                  <NewsCard
                    key={item.id}
                    item={item}
                    catLabel={CAT_EN[sid] ?? "NEWS"}
                    active={selected?.id === item.id}
                    onSelect={() => setSelected(item)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* ── ② WORKSPACE ── */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#161e33] bg-[#070b16]">
          {/* workspace header */}
          <div className="flex shrink-0 items-center gap-3 border-b border-[#141b2e] px-4 py-3">
            <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-indigo-500/50 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-bold tracking-wide text-indigo-300">
              <SlidersHorizontal className="size-3" />
              유튜브 롱폼 대본 생성기 WORKSPACE
            </span>
            <span className="hidden h-5 w-px bg-[#1d2845] lg:block" />
            <p className="min-w-0 flex-1 truncate text-[12px] text-slate-400">
              {selected ? (
                <>
                  <span className="text-slate-500">선택 뉴스: </span>
                  <span className="font-semibold text-slate-200">
                    {selected.title}
                  </span>
                </>
              ) : (
                "왼쪽 피드에서 뉴스를 선택하세요"
              )}
            </p>
            {!generating ? (
              <button
                onClick={generate}
                disabled={!selected || body.status === "loading"}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-blue-600 px-4 py-2 text-[12px] font-bold text-white shadow-[0_0_16px_rgba(79,90,245,0.45)] transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
              >
                {body.status === "loading" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {body.status === "loading"
                  ? "기사 본문 수집 중..."
                  : "유튜브 롱폼 대본 AI 제작"}
              </button>
            ) : (
              <button
                onClick={stop}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-[12px] font-bold text-red-300 transition hover:bg-red-500/20"
              >
                <Square className="size-3.5" /> 생성 중지
              </button>
            )}
          </div>

          {/* spec + output */}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(250px,310px)_minmax(0,1fr)]">
            {/* spec column */}
            <ScrollArea className="min-h-0 border-r border-[#141b2e]">
              <div className="space-y-5 p-4">
                <h3 className="flex items-center gap-1.5 text-[12px] font-bold tracking-wide text-slate-300">
                  <SlidersHorizontal className="size-3.5 text-indigo-400" />
                  대본 스펙 상세조정
                </h3>

                <Field label="🤖 AI 엔진">
                  <div className="grid grid-cols-2 gap-1.5">
                    <PillButton
                      active={engine === "ollama"}
                      onClick={() => setEngine("ollama")}
                    >
                      qwen3 (로컬·무료)
                    </PillButton>
                    <PillButton
                      active={engine === "claude"}
                      onClick={() => setEngine("claude")}
                    >
                      Claude Opus
                    </PillButton>
                  </div>
                  {engine === "ollama" && (
                    <p className="text-[10px] leading-relaxed text-slate-600">
                      로컬 Ollama qwen3:30b-a3b — 추론(thinking) 단계가 끝나야
                      본문이 나오기 시작합니다 (30초~1분 대기 정상)
                    </p>
                  )}
                </Field>

                <Field label="🎯 채널 고유 아이덴티티">
                  <input
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    className="h-9 w-full rounded-lg border border-[#1d2845] bg-[#0a101f] px-3 text-[12px] text-slate-200 focus:border-indigo-500/60 focus:outline-none"
                  />
                </Field>

                <Field label="👥 타겟 시청자층 타겟팅">
                  <select
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    className="h-9 w-full appearance-none rounded-lg border border-[#1d2845] bg-[#0a101f] px-3 text-[12px] text-slate-200 focus:border-indigo-500/60 focus:outline-none"
                  >
                    {AUDIENCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="⏱ 희망 유튜브 동영상 분량">
                  <div className="grid grid-cols-3 gap-1.5">
                    {LENGTH_OPTIONS.map((o) => (
                      <PillButton
                        key={o.value}
                        active={lengthMin === o.value}
                        onClick={() => setLengthMin(o.value)}
                      >
                        {o.label}
                      </PillButton>
                    ))}
                  </div>
                </Field>

                <Field label="🎙 스피치 진행 말투 (VOICE TONE)">
                  <div className="grid grid-cols-2 gap-1.5">
                    {TONE_OPTIONS.map((o) => (
                      <PillButton
                        key={o.value}
                        active={tone === o.value}
                        onClick={() => setTone(o.value)}
                      >
                        {o.label}
                      </PillButton>
                    ))}
                  </div>
                </Field>

                <div className="space-y-2 pt-1">
                  <CheckRow
                    checked={broll}
                    onChange={setBroll}
                    label="비디오 화면 연출 안 (B-Roll) 포함"
                  />
                  <CheckRow
                    checked={cues}
                    onChange={setCues}
                    label="중간 리액션 연출 신호(큐사인) 포함"
                  />
                  <CheckRow
                    checked={highlight}
                    onChange={setHighlight}
                    label="포인트 형광자막 배치 명칭 띄우기"
                  />
                </div>

                <div className="border-t border-[#141b2e] pt-4">
                  <div className="rounded-lg border border-[#1d2845] bg-[#0a101f] p-3">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                      <Info className="size-3.5 text-indigo-400" />
                      기사 본문 그라운딩{" "}
                      {body.status === "loading" && (
                        <Loader2 className="size-3 animate-spin text-amber-400" />
                      )}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                      {body.status === "ok" && body.text ? (
                        <>
                          기사 전문{" "}
                          <span className="font-semibold text-emerald-400">
                            {body.text.length.toLocaleString()}자
                          </span>
                          를 확보했습니다. 요약이 아닌 본문 전체를 사실 근거로
                          사용해 대본을 작성합니다.
                        </>
                      ) : body.status === "loading" ? (
                        "선택한 기사의 본문 전체를 수집하는 중입니다..."
                      ) : body.status === "fail" ? (
                        "본문 수집에 실패해 요약 기반으로 작성됩니다. 구체적 수치 인용은 자동으로 제한됩니다."
                      ) : (
                        "뉴스를 선택하면 기사 본문 전체를 자동 수집해, 단순 요약 수준을 넘는 사실 기반 대본을 작성합니다."
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </ScrollArea>

            {/* output column */}
            <div className="flex min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between px-4 pt-3">
                <p className="text-[11px] text-slate-600">
                  {generating
                    ? "원고 생성 중 — 실시간 스트리밍..."
                    : script
                      ? "원고 작성 완료"
                      : "원고 작업대 대기 중..."}
                </p>
                {script && !generating && (
                  <button
                    onClick={copy}
                    className="flex items-center gap-1 rounded-md border border-[#1d2845] bg-[#0a101f] px-2.5 py-1 text-[11px] font-semibold text-slate-400 transition hover:text-indigo-300"
                  >
                    {copied ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    {copied ? "복사됨" : "원고 복사"}
                  </button>
                )}
              </div>

              <div
                ref={outputRef}
                className="m-4 mt-2 min-h-0 flex-1 overflow-y-auto rounded-xl border-2 border-dashed border-[#22304f] p-5"
              >
                {genErr && (
                  <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-300">
                    {genErr}
                  </div>
                )}

                {!script && !generating && !genErr && (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <div className="mb-4 flex size-14 items-center justify-center rounded-xl bg-[#0d1322] text-indigo-400">
                      <BookOpen className="size-7" />
                    </div>
                    <h2 className="text-[15px] font-bold text-slate-200">
                      유튜브 롱폼 스튜디오 준비 완료
                    </h2>
                    <p className="mt-2 max-w-md text-[12px] leading-relaxed text-slate-500">
                      왼쪽 뉴스 피드에서 최신 속보를 클릭하여 선택한 뒤, 타겟
                      시청자와 진행 말투를 내 취향대로 정하고{" "}
                      <span className="font-semibold text-indigo-400">
                        [유튜브 롱폼 대본 AI 제작]
                      </span>{" "}
                      버튼을 누르면 정교한 방송 대본이 작성됩니다!
                    </p>
                    <div className="mt-6 max-w-md rounded-xl border border-[#1d2845] bg-[#0a101f] p-4 text-left">
                      <p className="flex items-center gap-1.5 text-[12px] font-bold text-slate-200">
                        <Flame className="size-3.5 text-orange-400" />
                        유튜브 썸네일 어그로/후킹 기법 최적 연동
                      </p>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                        기사 본문 전체를 크롤링해 사실 근거로 사용하며, 제목
                        후보 3종·썸네일 문구·B-Roll 연출 안·팩트 체크 노트까지
                        한 번에 생성됩니다. 한정된 요약 정보에 그치지 않고
                        심미성 높은 후킹이 대본 원고에 매력적으로 혼합
                        반영됩니다.
                      </p>
                    </div>
                  </div>
                )}

                {(script || generating) && (
                  <>
                    {generating && !script && (
                      <p className="mb-4 flex items-center gap-2 text-sm text-slate-400">
                        <Loader2 className="size-4 animate-spin text-indigo-400" />
                        기사를 분석하고 대본을 구상하는 중…
                      </p>
                    )}
                    <Markdown content={script} />
                    {generating && script && (
                      <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-indigo-400 align-text-bottom" />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ════ FOOTER ════ */}
      <footer className="flex h-9 shrink-0 items-center justify-between border-t border-[#141b2e] px-5 text-[11px] text-slate-600">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
            System Stable Ready
          </span>
          <span>NAVER 뉴스 섹션 + 기사 본문 크롤링 연동</span>
          <span>
            AI Engine:{" "}
            {engine === "ollama"
              ? "Ollama · qwen3:30b-a3b (로컬)"
              : "claude-opus-4-8"}
          </span>
        </div>
        <span>© 2026 YT Script Studio. All Rights Reserved.</span>
      </footer>
    </div>
  );
}

/* ───────── components ───────── */

function NewsCard({
  item,
  catLabel,
  active,
  onSelect,
}: {
  item: NewsItem;
  catLabel: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-xl border p-3.5 text-left transition ${
        active
          ? "border-indigo-500 bg-[#0a101f] shadow-[0_0_16px_rgba(79,90,245,0.25)]"
          : "border-[#1b2440] bg-[#090e1b] hover:border-[#2a3a66]"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="rounded border border-[#22304f] bg-[#0d1322] px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-slate-400">
          {catLabel}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
          <Clock3 className="size-3" />
          {item.datetime}
        </span>
      </div>
      <div className="mt-2 flex gap-2.5">
        <div className="min-w-0 flex-1">
          <h3
            className={`line-clamp-2 text-[13px] font-bold leading-snug ${
              active ? "text-indigo-300" : "text-slate-200"
            }`}
          >
            {item.title}
          </h3>
          {item.summary && (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
              {item.summary}
            </p>
          )}
        </div>
        {item.thumbnail && (
          <div className="h-[52px] w-[70px] shrink-0 overflow-hidden rounded-md border border-[#1b2440] bg-[#0d1322]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.thumbnail}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          </div>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-400">
          {item.press}
        </span>
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-0.5 text-[11px] font-semibold text-indigo-400 hover:underline"
        >
          원문 <ExternalLink className="size-3" />
        </a>
      </div>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-slate-400">
        {label}
      </label>
      {children}
    </div>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
        active
          ? "bg-indigo-600 text-white shadow-[0_0_12px_rgba(79,90,245,0.35)]"
          : "border border-[#1d2845] bg-[#0a101f] text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-indigo-500"
      />
      {label}
    </label>
  );
}

function Markdown({ content }: { content: string }) {
  return (
    <div className="text-[13.5px] leading-relaxed text-slate-300 [&>*+*]:mt-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => (
            <h2 className="mt-7 border-b border-[#1d2845] pb-2 text-lg font-bold text-slate-100 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-5 text-[14px] font-bold text-indigo-300">
              {children}
            </h3>
          ),
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-amber-300">{children}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-indigo-500/50 pl-3 text-slate-400">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-[#0d1322] px-1 py-0.5 text-[12px] text-indigo-300">
              {children}
            </code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-[#1b2440] bg-[#090e1b] p-3.5"
        >
          <div className="flex justify-between">
            <Skeleton className="h-3 w-14 bg-[#141b2e]" />
            <Skeleton className="h-3 w-16 bg-[#141b2e]" />
          </div>
          <Skeleton className="mt-2.5 h-4 w-full bg-[#141b2e]" />
          <Skeleton className="mt-1.5 h-4 w-2/3 bg-[#141b2e]" />
          <Skeleton className="mt-2.5 h-3 w-24 bg-[#141b2e]" />
        </div>
      ))}
    </>
  );
}
