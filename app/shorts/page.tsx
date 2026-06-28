"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Eye,
  Play,
  RefreshCw,
  ScissorsLineDashed,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";

import {
  COUNTRIES,
  countryByCode,
  formatDuration,
  formatViews,
  timeAgo,
  type ShortVideo,
} from "@/lib/youtube";

interface LoadError {
  message: string;
  needKey?: boolean;
}

export default function ShortsPage() {
  const [region, setRegion] = useState("KR");
  const [items, setItems] = useState<ShortVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async (rg: string, refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shorts?region=${rg}${refresh ? "&refresh=1" : ""}`);
      const data = await res.json();
      if (!res.ok) {
        setError({ message: data.error || "불러오지 못했습니다.", needKey: data.needKey });
        setItems([]);
      } else {
        setItems(data.items ?? []);
        setNow(Date.now());
      }
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "네트워크 오류" });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // 마이크로태스크로 미뤄 effect 본문에서 동기 setState 하지 않음
    Promise.resolve().then(() => {
      if (!cancelled) load(region);
    });
    return () => {
      cancelled = true;
    };
  }, [region, load]);

  const country = countryByCode(region)!;

  return (
    <main className="relative min-h-svh overflow-hidden bg-[#08060a] text-zinc-100">
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes shortsIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}`,
        }}
      />
      {/* 배경 레이어 */}
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(75%_130%_at_50%_-15%,rgba(255,45,85,0.20),transparent_70%)]" />
        <div className="absolute inset-0 opacity-[0.045] [background-image:radial-gradient(circle_at_center,#fff_1px,transparent_1px)] [background-size:22px_22px]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 pb-28 pt-8 sm:px-8">
        {/* 상단 내비 */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] font-semibold tracking-tight text-zinc-500">
            YT STUDIO
          </span>
          <Link
            href="/editor"
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[12px] font-semibold text-zinc-300 transition hover:border-white/20 hover:text-white"
          >
            <ScissorsLineDashed className="size-3.5" /> 편집기
          </Link>
        </div>

        {/* 헤더 */}
        <header className="mt-9">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.25em] text-rose-400">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-rose-500" />
            </span>
            지금 뜨는
          </div>
          <h1 className="mt-3 text-5xl font-black leading-[0.95] tracking-tight sm:text-7xl">
            트렌딩{" "}
            <span className="bg-gradient-to-br from-rose-400 via-orange-300 to-amber-200 bg-clip-text text-transparent">
              쇼츠
            </span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
            국가별로 지금 뜨는 실제 크리에이터 쇼츠 — 최근 7일 · 조회수순
          </p>
        </header>

        {/* 국가 레일 */}
        <nav className="mt-8 -mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {COUNTRIES.map((c) => {
            const active = region === c.code;
            return (
              <button
                key={c.code}
                onClick={() => setRegion(c.code)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "border-rose-400/40 bg-gradient-to-r from-rose-500 to-orange-500 text-white shadow-[0_6px_24px_-6px_rgba(255,45,85,0.7)]"
                    : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:bg-white/[0.07]"
                }`}
              >
                <span className="text-base leading-none">{c.flag}</span>
                {c.name}
              </button>
            );
          })}
        </nav>

        {/* 상태 바 */}
        <div className="mt-7 flex items-center justify-between">
          <div className="text-sm text-zinc-400">
            <span className="mr-1.5 text-base">{country.flag}</span>
            <b className="text-zinc-100">{country.name}</b>
            <span className="mx-2 text-zinc-700">|</span>
            {loading ? "불러오는 중…" : error ? "—" : `쇼츠 ${items.length}개`}
          </div>
          <button
            onClick={() => load(region, true)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[13px] font-semibold text-zinc-300 transition hover:border-white/20 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            새로고침
          </button>
        </div>

        {/* 본문 */}
        <div className="mt-6">
          {loading ? (
            <SkeletonGrid />
          ) : error ? (
            <ErrorCard error={error} onRetry={() => load(region, true)} />
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {items.map((v, i) => (
                <ShortCard key={v.id} v={v} rank={i + 1} now={now} index={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function ShortCard({
  v,
  rank,
  now,
  index,
}: {
  v: ShortVideo;
  rank: number;
  now: number;
  index: number;
}) {
  const top = rank <= 3;
  return (
    <a
      href={v.url}
      target="_blank"
      rel="noreferrer"
      style={{ animation: "shortsIn .5s both", animationDelay: `${Math.min(index, 20) * 35}ms` }}
      className="group relative block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition duration-300 hover:-translate-y-1 hover:border-rose-500/40 hover:shadow-[0_24px_48px_-24px_rgba(255,45,85,0.55)]"
    >
      <div className="relative aspect-[9/16] overflow-hidden bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={v.thumbnail}
          alt={v.title}
          loading="lazy"
          className="size-full object-cover transition duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-black/35" />

        {/* 랭크 */}
        <div
          className={`absolute left-2.5 top-2.5 flex h-8 min-w-8 items-center justify-center rounded-lg px-2 font-mono text-lg font-black tabular-nums ${
            top
              ? "bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-lg"
              : "bg-black/55 text-zinc-200 backdrop-blur"
          }`}
        >
          {rank}
        </div>

        {/* 길이 */}
        <div className="absolute bottom-2.5 right-2.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white backdrop-blur">
          {formatDuration(v.durationSec)}
        </div>

        {/* 호버 재생 */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition duration-300 group-hover:opacity-100">
          <div className="flex size-14 items-center justify-center rounded-full bg-rose-500/90 shadow-xl backdrop-blur">
            <Play className="size-6 translate-x-0.5 fill-white text-white" />
          </div>
        </div>

        {/* 정보 */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <h3 className="line-clamp-2 text-[13px] font-bold leading-snug text-white drop-shadow">
            {v.title}
          </h3>
          <p className="mt-1.5 truncate text-[11px] font-medium text-zinc-300">
            {v.channelTitle}
          </p>
          <div className="mt-1 flex items-center gap-2.5 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1">
              <Eye className="size-3" />
              <span className="font-mono tabular-nums">{formatViews(v.views)}</span>
            </span>
            {v.likes > 0 && (
              <span className="flex items-center gap-1">
                <ThumbsUp className="size-3" />
                <span className="font-mono tabular-nums">{formatViews(v.likes)}</span>
              </span>
            )}
            <span className="ml-auto">{timeAgo(v.publishedAt, now)}</span>
          </div>
        </div>
      </div>
    </a>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 15 }).map((_, i) => (
        <div
          key={i}
          className="aspect-[9/16] animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
      <p className="text-base font-bold text-zinc-200">표시할 쇼츠가 없습니다</p>
      <p className="mt-2 text-sm text-zinc-500">
        이 국가의 최근 7일 인기 쇼츠를 찾지 못했어요. 다른 국가를 선택하거나 새로고침해 보세요.
      </p>
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: LoadError; onRetry: () => void }) {
  return (
    <div className="mx-auto mt-14 max-w-lg rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-6 text-center">
      <TriangleAlert className="mx-auto size-8 text-amber-400" />
      <h3 className="mt-3 text-lg font-bold text-zinc-100">
        {error.needKey ? "YouTube API 키가 필요합니다" : "불러오지 못했습니다"}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{error.message}</p>
      {error.needKey && (
        <div className="mt-4 rounded-xl bg-black/40 p-4 text-left text-[12px] leading-relaxed text-zinc-400">
          <p className="mb-2 font-bold text-zinc-200">설정 방법</p>
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>
              <a
                href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                target="_blank"
                rel="noreferrer"
                className="text-rose-300 underline underline-offset-2"
              >
                Google Cloud Console
              </a>
              에서 <b className="text-zinc-200">YouTube Data API v3</b> 활성화 → API 키 발급(무료)
            </li>
            <li>
              <code className="rounded bg-white/10 px-1 py-0.5">.env.local</code> 에{" "}
              <code className="rounded bg-white/10 px-1 py-0.5">YOUTUBE_API_KEY=발급한키</code> 추가
            </li>
            <li>dev 서버 재시작 후 새로고침</li>
          </ol>
        </div>
      )}
      <button
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-5 py-2 text-[13px] font-bold text-white transition hover:bg-rose-400"
      >
        <RefreshCw className="size-3.5" /> 다시 시도
      </button>
    </div>
  );
}
