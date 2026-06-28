"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Italic,
  Sparkles,
  SlidersHorizontal,
  Trash2,
  Volume2,
} from "lucide-react";
import { useCallback, useState } from "react";

import {
  ASPECT_OPTIONS,
  FONT_OPTIONS,
  SWATCHES,
} from "@/lib/editor/constants";
import { shallowArray, useActions, useEditor } from "@/lib/editor/store";
import { TEMPLATES } from "@/lib/editor/templates";
import type { Align, Clip, VAlign } from "@/lib/editor/types";
import { ScriptPanel } from "./script-panel";
import { TtsPanel } from "./tts-panel";

type InspectorTab = "props" | "script" | "tts";

export function Inspector() {
  const clips = useEditor((s) => s.project.clips);
  const selectedIds = useEditor((s) => s.selectedIds, shallowArray);
  const actions = useActions();
  const [tab, setTab] = useState<InspectorTab>("props");

  const selected = clips.filter((c) => selectedIds.includes(c.id));

  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-hidden border-l border-[#161e33] bg-[#070b16]">
      {/* 탭 바 */}
      <div className="flex h-11 shrink-0 border-b border-[#141b2e]">
        <InspectorTabBtn
          active={tab === "props"}
          onClick={() => setTab("props")}
          icon={<SlidersHorizontal className="size-3.5" />}
        >
          속성
        </InspectorTabBtn>
        <InspectorTabBtn
          active={tab === "script"}
          onClick={() => setTab("script")}
          icon={<Sparkles className="size-3.5" />}
        >
          대본
        </InspectorTabBtn>
        <InspectorTabBtn
          active={tab === "tts"}
          onClick={() => setTab("tts")}
          icon={<Volume2 className="size-3.5" />}
        >
          음성
        </InspectorTabBtn>
      </div>

      {tab === "script" ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <ScriptPanel />
        </div>
      ) : tab === "tts" ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <TtsPanel />
        </div>
      ) : (
        <>
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#141b2e] px-4">
            <span className="text-[12px] font-bold text-slate-200">
              {selected.length === 0
                ? "프로젝트 설정"
                : selected.length === 1
                  ? "속성 편집"
                  : `${selected.length}개 선택됨`}
            </span>
            {selected.length > 0 && (
              <div className="flex gap-1.5">
                <button
                  title="복제"
                  onClick={() => actions.duplicateSelected()}
                  className="flex size-7 items-center justify-center rounded-md border border-[#1d2845] bg-[#0a101f] text-slate-400 hover:text-indigo-300"
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  title="삭제"
                  onClick={() => actions.removeSelected()}
                  className="flex size-7 items-center justify-center rounded-md border border-[#1d2845] bg-[#0a101f] text-slate-400 hover:text-rose-300"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            {selected.length === 0 && <ProjectPanel />}
            {selected.length === 1 && <ClipPanel clip={selected[0]} />}
            {selected.length > 1 && (
              <p className="text-[12px] leading-relaxed text-slate-500">
                여러 클립이 선택되었습니다. 캔버스에서 함께 이동하거나 상단 버튼으로
                복제·삭제할 수 있습니다.
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function InspectorTabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 text-[12px] font-semibold transition ${
        active
          ? "border-b-2 border-indigo-500 text-indigo-300"
          : "border-b-2 border-transparent text-slate-500 hover:text-slate-300"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/* ───────── 프로젝트 패널 ───────── */

function ProjectPanel() {
  const name = useEditor((s) => s.project.name);
  const aspect = useEditor((s) => s.project.aspect);
  const background = useEditor((s) => s.project.background);
  const watermark = useEditor((s) => s.project.watermark);
  const actions = useActions();

  return (
    <>
      <Section title="프로젝트 이름">
        <input
          value={name}
          onChange={(e) => actions.setProjectName(e.target.value)}
          className="inp"
        />
      </Section>
      <Section title="화면 비율">
        <select
          value={aspect}
          onChange={(e) =>
            actions.setAspect(e.target.value as (typeof ASPECT_OPTIONS)[number]["value"])
          }
          className="inp"
        >
          {ASPECT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Section>
      <Section title="배경">
        <div className="grid grid-cols-3 gap-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              title={t.name}
              onClick={() => actions.setBackground(t.background)}
              className={`h-12 rounded-lg border ${
                background === t.background
                  ? "border-indigo-400"
                  : "border-[#1d2845]"
              }`}
              style={{ background: t.background }}
            />
          ))}
        </div>
        <ColorRow
          label="단색 배경"
          value={background.startsWith("#") ? background : "#0b1020"}
          onChange={(v) => actions.setBackground(v)}
        />
      </Section>
      <Section title="워터마크">
        <Toggle
          label="가운데 워터마크"
          checked={watermark.enabled}
          onChange={(on) => actions.setWatermark({ enabled: on })}
        />
        {watermark.enabled && (
          <>
            <input
              value={watermark.text}
              onChange={(e) => actions.setWatermark({ text: e.target.value })}
              placeholder="채널명·문구"
              className="inp"
            />
            <Range
              label={`흐림(투명도) ${Math.round(watermark.opacity * 100)}%`}
              min={0.03}
              max={0.6}
              step={0.01}
              value={watermark.opacity}
              onChange={(v) => actions.setWatermark({ opacity: v }, false)}
            />
            <p className="text-[10px] leading-relaxed text-slate-600">
              영상·이미지를 처음 넣으면 자동으로 켜집니다. 화면 가운데에 흐릿하게
              표시됩니다.
            </p>
          </>
        )}
      </Section>
      <p className="rounded-lg border border-[#1d2845] bg-[#0a101f] p-3 text-[11px] leading-relaxed text-slate-500">
        클립을 선택하면 여기에서 글꼴·색·위치·타이밍을 세밀하게 조정할 수
        있습니다. 캔버스에서 더블클릭하면 텍스트를 바로 편집합니다.
      </p>
    </>
  );
}

/* ───────── 클립 패널 ───────── */

function ClipPanel({ clip }: { clip: Clip }) {
  const actions = useActions();
  const set = useCallback(
    (patch: Partial<Clip>) => actions.updateClip(clip.id, patch),
    [actions, clip.id],
  );
  const setLive = useCallback(
    (patch: Partial<Clip>) => actions.updateClip(clip.id, patch, false),
    [actions, clip.id],
  );

  return (
    <>
      <Section title="이름">
        <input
          value={clip.name}
          onChange={(e) => set({ name: e.target.value })}
          className="inp"
        />
      </Section>

      {clip.type === "text" && (
        <TextControls clip={clip} set={set} setLive={setLive} />
      )}
      {clip.type === "shape" && <ShapeControls clip={clip} set={set} setLive={setLive} />}
      {(clip.type === "image" || clip.type === "video") && (
        <MediaVisualControls clip={clip} set={set} setLive={setLive} />
      )}
      {(clip.type === "video" || clip.type === "audio") && (
        <AudioControls clip={clip} set={set} setLive={setLive} />
      )}

      {clip.type !== "audio" && (
        <Section title="위치 / 크기">
          <div className="grid grid-cols-2 gap-2">
            <Num label="X" value={Math.round(clip.x)} onChange={(v) => set({ x: v })} />
            <Num label="Y" value={Math.round(clip.y)} onChange={(v) => set({ y: v })} />
            <Num label="너비" value={Math.round(clip.width)} onChange={(v) => set({ width: Math.max(8, v) })} />
            <Num label="높이" value={Math.round(clip.height)} onChange={(v) => set({ height: Math.max(8, v) })} />
          </div>
          <Range
            label={`회전 ${Math.round(clip.rotation)}°`}
            min={-180}
            max={180}
            step={1}
            value={clip.rotation}
            onChange={(v) => setLive({ rotation: v })}
          />
          <Range
            label={`불투명도 ${Math.round(clip.opacity * 100)}%`}
            min={0}
            max={1}
            step={0.01}
            value={clip.opacity}
            onChange={(v) => setLive({ opacity: v })}
          />
        </Section>
      )}

      <Section title="타이밍 (초)">
        <div className="grid grid-cols-2 gap-2">
          <Num
            label="시작"
            value={round1(clip.start)}
            step={0.1}
            onChange={(v) => set({ start: Math.max(0, v) })}
          />
          <Num
            label="길이"
            value={round1(clip.duration)}
            step={0.1}
            onChange={(v) => set({ duration: Math.max(0.2, v) })}
          />
        </div>
      </Section>
    </>
  );
}

function TextControls({
  clip,
  set,
  setLive,
}: {
  clip: Extract<Clip, { type: "text" }>;
  set: (p: Partial<Clip>) => void;
  setLive: (p: Partial<Clip>) => void;
}) {
  return (
    <>
      <Section title="텍스트">
        <textarea
          value={clip.text}
          onChange={(e) => set({ text: e.target.value })}
          rows={3}
          className="inp resize-none"
        />
      </Section>
      <Section title="글꼴">
        <select
          value={clip.fontFamily}
          onChange={(e) => set({ fontFamily: e.target.value })}
          className="inp"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <SegBtn
            active={clip.fontWeight >= 700}
            onClick={() => set({ fontWeight: clip.fontWeight >= 700 ? 400 : 800 })}
            title="굵게"
          >
            <Bold className="size-3.5" />
          </SegBtn>
          <SegBtn active={clip.italic} onClick={() => set({ italic: !clip.italic })} title="기울임">
            <Italic className="size-3.5" />
          </SegBtn>
          <div className="ml-1 flex gap-1">
            {(
              [
                ["left", AlignLeft],
                ["center", AlignCenter],
                ["right", AlignRight],
              ] as const
            ).map(([a, Icon]) => (
              <SegBtn key={a} active={clip.align === a} onClick={() => set({ align: a as Align })} title={a}>
                <Icon className="size-3.5" />
              </SegBtn>
            ))}
          </div>
        </div>
        <Range
          label={`크기 ${Math.round(clip.fontSize)}px`}
          min={8}
          max={400}
          step={1}
          value={clip.fontSize}
          onChange={(v) => setLive({ fontSize: v })}
        />
        <Range
          label={`줄 높이 ${clip.lineHeight.toFixed(2)}`}
          min={0.8}
          max={2.4}
          step={0.05}
          value={clip.lineHeight}
          onChange={(v) => setLive({ lineHeight: v })}
        />
        <Range
          label={`자간 ${clip.letterSpacing}px`}
          min={-5}
          max={30}
          step={0.5}
          value={clip.letterSpacing}
          onChange={(v) => setLive({ letterSpacing: v })}
        />
        <div className="flex gap-2 pt-1">
          <SegBtn active={clip.vAlign === "top"} onClick={() => set({ vAlign: "top" as VAlign })} title="상단">위</SegBtn>
          <SegBtn active={clip.vAlign === "middle"} onClick={() => set({ vAlign: "middle" as VAlign })} title="중앙">중간</SegBtn>
          <SegBtn active={clip.vAlign === "bottom"} onClick={() => set({ vAlign: "bottom" as VAlign })} title="하단">아래</SegBtn>
        </div>
      </Section>
      <Section title="색상">
        <ColorRow label="글자색" value={clip.color} onChange={(v) => set({ color: v })} />
        <Swatches onPick={(v) => set({ color: v })} />
        <Toggle
          label="자막 배경"
          checked={!!clip.background}
          onChange={(on) =>
            set({ background: on ? "rgba(8,12,24,0.72)" : null })
          }
        />
        {clip.background && (
          <ColorRow
            label="배경색"
            value={clip.background}
            onChange={(v) => set({ background: v })}
          />
        )}
        <Toggle label="그림자" checked={clip.shadow} onChange={(on) => set({ shadow: on })} />
        <Toggle
          label="외곽선"
          checked={!!clip.stroke}
          onChange={(on) =>
            set({ stroke: on ? { color: "#000000", width: 6 } : null })
          }
        />
        {clip.stroke && (
          <>
            <ColorRow
              label="외곽선 색"
              value={clip.stroke.color}
              onChange={(v) => set({ stroke: { ...clip.stroke!, color: v } })}
            />
            <Range
              label={`외곽선 두께 ${clip.stroke.width}px`}
              min={1}
              max={30}
              step={1}
              value={clip.stroke.width}
              onChange={(v) => setLive({ stroke: { ...clip.stroke!, width: v } })}
            />
          </>
        )}
      </Section>
    </>
  );
}

function ShapeControls({
  clip,
  set,
  setLive,
}: {
  clip: Extract<Clip, { type: "shape" }>;
  set: (p: Partial<Clip>) => void;
  setLive: (p: Partial<Clip>) => void;
}) {
  return (
    <Section title="도형">
      <div className="flex gap-2">
        <SegBtn active={clip.shape === "rect"} onClick={() => set({ shape: "rect" })} title="사각형">
          사각형
        </SegBtn>
        <SegBtn active={clip.shape === "ellipse"} onClick={() => set({ shape: "ellipse" })} title="원">
          원/타원
        </SegBtn>
      </div>
      <ColorRow label="채우기" value={clip.fill} onChange={(v) => set({ fill: v })} />
      <Swatches onPick={(v) => set({ fill: v })} />
      {clip.shape === "rect" && (
        <Range
          label={`모서리 ${clip.radius}px`}
          min={0}
          max={300}
          step={1}
          value={clip.radius}
          onChange={(v) => setLive({ radius: v })}
        />
      )}
    </Section>
  );
}

function MediaVisualControls({
  clip,
  set,
  setLive,
}: {
  clip: Extract<Clip, { type: "image" | "video" }>;
  set: (p: Partial<Clip>) => void;
  setLive: (p: Partial<Clip>) => void;
}) {
  return (
    <Section title="화면 채우기">
      <div className="flex gap-2">
        {(["cover", "contain", "fill"] as const).map((f) => (
          <SegBtn key={f} active={clip.objectFit === f} onClick={() => set({ objectFit: f })} title={f}>
            {f === "cover" ? "꽉 채움" : f === "contain" ? "맞춤" : "늘림"}
          </SegBtn>
        ))}
      </div>
      <Range
        label={`모서리 둥글기 ${clip.radius}px`}
        min={0}
        max={300}
        step={1}
        value={clip.radius}
        onChange={(v) => setLive({ radius: v })}
      />
    </Section>
  );
}

function AudioControls({
  clip,
  set,
  setLive,
}: {
  clip: Extract<Clip, { type: "video" | "audio" }>;
  set: (p: Partial<Clip>) => void;
  setLive: (p: Partial<Clip>) => void;
}) {
  return (
    <Section title="소리">
      <Range
        label={`볼륨 ${Math.round(clip.volume * 100)}%`}
        min={0}
        max={1}
        step={0.01}
        value={clip.volume}
        onChange={(v) => setLive({ volume: v })}
      />
      <Toggle label="음소거" checked={clip.muted} onChange={(on) => set({ muted: on })} />
    </Section>
  );
}

/* ───────── 공통 컨트롤 ───────── */

const round1 = (n: number) => Math.round(n * 10) / 10;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-[#1d2845] bg-[#0a101f] px-2">
      <span className="text-[10px] font-semibold text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="h-8 w-full bg-transparent text-[12px] text-slate-200 outline-none"
      />
    </label>
  );
}

function Range({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const actions = useActions();
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-slate-400">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => actions.beginInteraction()}
        onPointerUp={() => actions.endInteraction()}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 w-full cursor-pointer accent-indigo-500"
      />
    </label>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-[#1d2845] bg-[#0a101f] px-2.5 py-1.5">
      <span className="text-[11px] text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-20 bg-transparent text-right font-mono text-[11px] text-slate-300 outline-none"
        />
        <input
          type="color"
          value={toHex(value)}
          onChange={(e) => onChange(applyHexKeepAlpha(value, e.target.value))}
          className="size-6 cursor-pointer rounded border border-[#1d2845] bg-transparent"
        />
      </div>
    </div>
  );
}

function Swatches({ onPick }: { onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SWATCHES.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className="size-5 rounded-full border border-white/20"
          style={{ background: c }}
          title={c}
        />
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 text-[12px] text-slate-300">
      {label}
      <button
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition ${
          checked ? "bg-indigo-500" : "bg-[#1d2845]"
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function SegBtn({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-[11px] font-semibold transition ${
        active
          ? "border-indigo-500 bg-indigo-600 text-white"
          : "border-[#1d2845] bg-[#0a101f] text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

/** 이전 값이 반투명(rgba alpha<1)이면 새 hex 에 그 알파를 보존 */
function applyHexKeepAlpha(prev: string, hex: string): string {
  const m = prev.match(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/i);
  const a = m ? Number(m[1]) : 1;
  if (a < 1 && !Number.isNaN(a) && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return hex;
}

/** rgba/hex → #rrggbb (color input 용) */
function toHex(c: string): string {
  if (c.startsWith("#")) return c.slice(0, 7);
  const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) {
    const h = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  }
  return "#000000";
}
