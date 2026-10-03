"use client";

import clsx from "clsx";
import { ChevronDown, RotateCcw, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type AreaUnit, formatManwon, M2_PER_PYEONG } from "@/lib/format";
import { activeFilterCount, COMPLEX_TYPES, EMPTY_FILTERS, FILTER_PRESETS, type MapFilters, type SortKey } from "@/lib/map-filters";

/*
 * 지도 후보 탐색 조건. 값은 기준 단위(만원·평당 만원·㎡·비율)로 갖고, 입력 칸만 보기 좋은 단위(억·설정 면적 단위·%)로 바꿔 보여 준다.
 * 조건 하나하나(가격·평형·준공…)를 섹션으로 정의해 두고, 상단 칩(누르면 그 조건만 바로)과 전체 조건 패널이 같이 쓴다.
 */

type Scale = { toView: (v: number) => number; fromView: (v: number) => number; digits: number };
const id: Scale = { toView: (v) => v, fromView: (v) => v, digits: 0 };
const eok: Scale = { toView: (v) => v / 10_000, fromView: (v) => Math.round(v * 10_000), digits: 2 };
const pct: Scale = { toView: (v) => v * 100, fromView: (v) => v / 100, digits: 1 };

const round = (v: number, d: number) => String(Number(v.toFixed(d)));

/** 숫자 입력(입력 중 "1." 같은 중간 값을 지우지 않도록 글자는 따로 들고 있는다) */
function NumInput({ value, onChange, scale, placeholder }: { value: number | null; onChange: (v: number | null) => void; scale: Scale; placeholder?: string }) {
  const show = (v: number | null) => (v === null ? "" : round(scale.toView(v), scale.digits));
  const [text, setText] = useState(show(value));
  // 바깥 값이 바뀌면(빠른 조건·초기화) 입력 칸을 맞춘다 — 렌더 중 상태 조정
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    const cur = text.trim() === "" ? null : scale.fromView(Number(text));
    if (value === null ? cur !== null : cur === null || Math.abs(cur - value) > 1e-9) setText(show(value));
  }
  return (
    <input
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.\-]/g, "");
        setText(t);
        const n = Number(t);
        onChange(t.trim() === "" || t === "-" || !Number.isFinite(n) ? null : scale.fromView(n));
      }}
      className="h-10 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-sm tabular outline-none focus:border-accent"
    />
  );
}

function Range({ min, max, onMin, onMax, scale, unit }: { min: number | null; max: number | null; onMin: (v: number | null) => void; onMax: (v: number | null) => void; scale: Scale; unit: string }) {
  return (
    <div className="mt-2 flex items-center gap-1.5 text-sm">
      <NumInput value={min} onChange={onMin} scale={scale} placeholder="최소" />
      <span className="text-muted">~</span>
      <NumInput value={max} onChange={onMax} scale={scale} placeholder="최대" />
      <span className="w-12 shrink-0 text-xs text-muted">{unit}</span>
    </div>
  );
}

type QuickItem = { label: string; active: boolean; onClick: () => void };

function Quick({ items }: { items: QuickItem[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((q) => (
        <button
          key={q.label}
          type="button"
          onClick={q.onClick}
          className={clsx("rounded-full border px-3 py-1.5 text-sm", q.active ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-text hover:bg-surface-2")}
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}

type Section = {
  key: string;
  /** 칩·제목 */
  label: string;
  hint?: string;
  /** 켜져 있으면 칩에 보일 값(예: 6~10억) */
  summary: string | null;
  clear: () => void;
  quick: QuickItem[];
  range?: React.ReactNode;
};

/** 범위 → "6~10억", "~3억", "2016년~" */
function rangeText(lo: number | null, hi: number | null, f: (v: number) => string): string | null {
  if (lo === null && hi === null) return null;
  if (lo !== null && hi !== null) return `${f(lo)}~${f(hi)}`;
  return lo !== null ? `${f(lo)}~` : `~${f(hi!)}`;
}

function buildSections({
  filters,
  onChange,
  type,
  unit,
  kind,
  onPicked,
}: {
  filters: MapFilters;
  onChange: (f: MapFilters) => void;
  type: string;
  unit: AreaUnit;
  kind: "sale" | "jeonse";
  /** 빠른 값을 고른 뒤(칩 팝오버는 닫는다) */
  onPicked?: () => void;
}): Section[] {
  const complex = COMPLEX_TYPES.has(type);
  const year = new Date().getFullYear();
  const set = (patch: Partial<MapFilters>) => onChange({ ...filters, ...patch });
  const is = (patch: Partial<MapFilters>) => (Object.keys(patch) as (keyof MapFilters)[]).every((k) => filters[k] === patch[k]);
  // 같은 값을 다시 누르면 끈다
  const toggle = (patch: Partial<MapFilters>) => {
    set(is(patch) ? Object.fromEntries(Object.keys(patch).map((k) => [k, null])) : patch);
    onPicked?.();
  };
  const quick = <K extends keyof MapFilters>(lo: K, hi: K | null, opts: [string, number | null, number | null][]): QuickItem[] =>
    opts.map(([label, a, b]) => {
      const patch = (hi ? { [lo]: a, [hi]: b } : { [lo]: a }) as Partial<MapFilters>;
      return { label, active: is(patch), onClick: () => toggle(patch) };
    });
  const summary = (items: QuickItem[], text: string | null) => (text === null ? null : (items.find((q) => q.active)?.label ?? text));
  const pyeong = unit === "pyeong";
  const areaScale: Scale = pyeong ? { toView: (v) => v / M2_PER_PYEONG, fromView: (v) => v * M2_PER_PYEONG, digits: 1 } : { ...id, digits: 1 };
  const ppyScale: Scale = pyeong ? id : { toView: (v) => v / M2_PER_PYEONG, fromView: (v) => v * M2_PER_PYEONG, digits: 0 };
  const eokText = (v: number) => formatManwon(v, { short: true });
  const pctText = (v: number) => `${round(v * 100, 0)}%`;

  const price = quick("priceMin", "priceMax", [
    ["~3억", null, 30_000],
    ["3~6억", 30_000, 60_000],
    ["6~10억", 60_000, 100_000],
    ["10~15억", 100_000, 150_000],
    ["15억~", 150_000, null],
  ]);
  const area = quick(
    "areaMin",
    "areaMax",
    complex
      ? [
          ["소형 ~60㎡", null, 60],
          ["국민평형 84㎡", 80, 90],
          ["중형 60~85㎡", 60, 85],
          ["중대형 85~135㎡", 85, 135],
          ["대형 135㎡~", 135, null],
        ]
      : [
          ["~330㎡(100평)", null, 330],
          ["330~1,000㎡", 330, 1000],
          ["1,000~3,300㎡", 1000, 3300],
          ["3,300㎡(1천평)~", 3300, null],
        ],
  );
  const built = quick("yearMin", "yearMax", [
    ["5년 이내", year - 5, null],
    ["10년 이내", year - 10, null],
    ["20년 이내", year - 20, null],
    ["30년 이상", null, year - 30],
  ]);
  const hh = quick("hhMin", null, [
    ["300세대+", 300, null],
    ["500세대+", 500, null],
    ["1,000세대+", 1000, null],
    ["2,000세대+", 2000, null],
  ]);
  const jr = quick("jrMin", "jrMax", [
    ["50% 이하", null, 0.5],
    ["60%+", 0.6, null],
    ["70%+", 0.7, null],
    ["80%+ (깡통 주의)", 0.8, null],
  ]);
  const chg = quick("chgMin", "chgMax", [
    ["하락", null, 0],
    ["상승", 0, null],
    ["+5% 이상", 0.05, null],
    ["+10% 이상", 0.1, null],
  ]);
  const loc = quick("locMin", null, [
    ["60점+", 60, null],
    ["70점+", 70, null],
    ["80점+", 80, null],
  ]);
  const areaUnit = pyeong ? "평" : "㎡";
  const areaText = (v: number) => `${round(areaScale.toView(v), 0)}${areaUnit}`;

  const sections: (Section & { complexOnly?: boolean })[] = [
    {
      key: "price",
      label: kind === "jeonse" ? "전세가" : "매매가",
      hint: "중위 가격 · 고른 기간 기준",
      summary: summary(price, rangeText(filters.priceMin, filters.priceMax, eokText)),
      clear: () => set({ priceMin: null, priceMax: null }),
      quick: price,
      range: <Range min={filters.priceMin} max={filters.priceMax} onMin={(v) => set({ priceMin: v })} onMax={(v) => set({ priceMax: v })} scale={eok} unit="억" />,
    },
    {
      key: "area",
      label: complex ? "평형" : "면적",
      hint: complex ? "전용면적 · 이 면적의 거래만 집계" : "토지·연면적 · 이 면적의 거래만 집계",
      summary: summary(area, rangeText(filters.areaMin, filters.areaMax, areaText)),
      clear: () => set({ areaMin: null, areaMax: null }),
      quick: area,
      range: <Range min={filters.areaMin} max={filters.areaMax} onMin={(v) => set({ areaMin: v })} onMax={(v) => set({ areaMax: v })} scale={areaScale} unit={areaUnit} />,
    },
    {
      key: "year",
      label: "준공",
      complexOnly: true,
      summary: summary(built, rangeText(filters.yearMin, filters.yearMax, (v) => `${v}년`)),
      clear: () => set({ yearMin: null, yearMax: null }),
      quick: built,
      range: <Range min={filters.yearMin} max={filters.yearMax} onMin={(v) => set({ yearMin: v })} onMax={(v) => set({ yearMax: v })} scale={id} unit="년" />,
    },
    {
      key: "hh",
      label: "세대수",
      hint: "건축물대장을 불러온 단지만 남습니다",
      complexOnly: true,
      summary: summary(hh, filters.hhMin === null ? null : `${filters.hhMin.toLocaleString()}세대+`),
      clear: () => set({ hhMin: null }),
      quick: hh,
    },
    {
      key: "jr",
      label: "전세가율",
      hint: "최근 12개월 ㎡당 전세 ÷ 매매",
      summary: summary(jr, rangeText(filters.jrMin, filters.jrMax, pctText)),
      clear: () => set({ jrMin: null, jrMax: null }),
      quick: jr,
      range: <Range min={filters.jrMin} max={filters.jrMax} onMin={(v) => set({ jrMin: v })} onMax={(v) => set({ jrMax: v })} scale={pct} unit="%" />,
    },
    {
      key: "chg",
      label: "1년 변동",
      hint: "최근 6개월 vs 1년 전 같은 기간 ㎡당 중위",
      summary: summary(chg, rangeText(filters.chgMin, filters.chgMax, pctText)),
      clear: () => set({ chgMin: null, chgMax: null }),
      quick: chg,
      range: <Range min={filters.chgMin} max={filters.chgMax} onMin={(v) => set({ chgMin: v })} onMax={(v) => set({ chgMax: v })} scale={pct} unit="%" />,
    },
    {
      key: "loc",
      label: "입지",
      hint: "점수를 계산한 단지만 남습니다",
      complexOnly: true,
      summary: summary(loc, filters.locMin === null ? null : `${filters.locMin}점+`),
      clear: () => set({ locMin: null }),
      quick: loc,
    },
    {
      key: "ppy",
      label: pyeong ? "평당가" : "㎡당 가격",
      summary: rangeText(filters.ppyMin, filters.ppyMax, (v) => formatManwon(ppyScale.toView(v), { short: true })),
      clear: () => set({ ppyMin: null, ppyMax: null }),
      quick: [],
      range: <Range min={filters.ppyMin} max={filters.ppyMax} onMin={(v) => set({ ppyMin: v })} onMax={(v) => set({ ppyMax: v })} scale={ppyScale} unit={pyeong ? "만원/평" : "만원/㎡"} />,
    },
  ];
  return sections.filter((s) => complex || !s.complexOnly);
}

function presetItems(filters: MapFilters, type: string, onChange: (f: MapFilters) => void, onSort: (s: SortKey) => void, onPicked?: () => void): QuickItem[] {
  const complex = COMPLEX_TYPES.has(type);
  const year = new Date().getFullYear();
  return FILTER_PRESETS.filter((p) => complex || !p.complexOnly).map((p) => {
    const patch = p.filters(year);
    // 이 묶음의 값만 켜져 있을 때
    const active = (Object.keys(EMPTY_FILTERS) as (keyof MapFilters)[]).every((k) => filters[k] === (patch[k] ?? null));
    return {
      label: p.label,
      active,
      onClick: () => {
        onChange(active ? EMPTY_FILTERS : { ...EMPTY_FILTERS, ...patch });
        if (p.sort && !active) onSort(p.sort);
        onPicked?.();
      },
    };
  });
}

function ResultLine({ count, resultCount, truncated }: { count: number; resultCount: number; truncated: boolean }) {
  return (
    <div className="border-t border-border px-3 py-2 text-xs text-muted">
      {count ? `조건 ${count}개 · ` : ""}이 화면에서 <b className="text-text">{resultCount.toLocaleString()}곳</b>
      {truncated ? " (최대 400곳 — 지도를 확대하면 더 정확합니다)" : ""}
    </div>
  );
}

type BarProps = {
  filters: MapFilters;
  onChange: (f: MapFilters) => void;
  onSort: (s: SortKey) => void;
  type: string;
  unit: AreaUnit;
  kind: "sale" | "jeonse";
  months: number;
  onMonths: (m: number) => void;
  resultCount: number;
  truncated: boolean;
  onOpenAll: () => void;
};

const MONTHS = [3, 6, 12, 36];
const monthLabel = (m: number) => (m < 12 ? `${m}개월` : `${m / 12}년`);

/**
 * 상단 조건 칩 줄(호갱노노·네이버 부동산식): 조건마다 칩이 있고, 누르면 그 조건의 빠른 값이 바로 뜬다(한 번 더 누르면 적용·닫힘).
 * 켜진 칩은 값(6~10억)을 보여 주고 ✕로 바로 끈다.
 */
export function FilterBar({ filters, onChange, onSort, type, unit, kind, months, onMonths, resultCount, truncated, onOpenAll }: BarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const close = () => setOpen(null);
  const sections = buildSections({ filters, onChange, type, unit, kind, onPicked: close });
  const presets = presetItems(filters, type, onChange, onSort, close);
  const count = activeFilterCount(filters, type);
  const presetOn = presets.find((p) => p.active);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (key: string, e: React.MouseEvent<HTMLElement>) => {
    if (open === key) return setOpen(null);
    const r = row.current?.getBoundingClientRect();
    const c = e.currentTarget.getBoundingClientRect();
    setLeft(r ? Math.max(0, c.left - r.left) : 0);
    setOpen(key);
  };
  const section = sections.find((s) => s.key === open);

  return (
    <div ref={wrap} className="relative">
      <div ref={row} className="no-scrollbar flex items-center gap-1.5 overflow-x-auto px-3 pb-2 lg:px-4">
        <button
          type="button"
          onClick={() => {
            close();
            onOpenAll();
          }}
          aria-label="전체 조건"
          className={clsx(
            "flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-sm",
            count ? "border-accent bg-accent text-white" : "border-border text-text hover:bg-surface-2",
          )}
        >
          <SlidersHorizontal size={14} />
          {count ? <b>{count}</b> : null}
        </button>
        <BarChip label="추천" icon={<Sparkles size={13} />} value={presetOn?.label ?? null} open={open === "preset"} onClick={(e) => toggle("preset", e)} onClear={presetOn ? () => onChange(EMPTY_FILTERS) : undefined} />
        <BarChip label="기간" value={monthLabel(months)} quiet open={open === "months"} onClick={(e) => toggle("months", e)} />
        {sections
          .filter((s) => s.key !== "ppy" || s.summary)
          .map((s) => (
            <BarChip key={s.key} label={s.label} value={s.summary} open={open === s.key} onClick={(e) => toggle(s.key, e)} onClear={s.clear} />
          ))}
        {count ? (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="flex h-9 shrink-0 items-center gap-1 px-2 text-sm text-muted hover:text-text">
            <RotateCcw size={13} />
            초기화
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          className="absolute inset-x-2 top-full z-20 flex max-h-[min(70vh,28rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface text-sm shadow-lg sm:right-auto sm:w-80 sm:left-[var(--pop-left)]"
          style={{ "--pop-left": `${Math.max(8, left)}px` } as React.CSSProperties}
        >
          <div className="flex items-center justify-between gap-2 px-3 pt-3">
            <b>{open === "preset" ? "추천 조건" : open === "months" ? "거래 기간" : section?.label}</b>
            <span className="flex items-center gap-3">
              {section?.summary ? (
                <button type="button" className="text-xs text-accent" onClick={section.clear}>
                  해제
                </button>
              ) : null}
              <button type="button" aria-label="닫기" onClick={close} className="text-muted">
                <X size={16} />
              </button>
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
            {section?.hint ? <p className="mb-2 text-xs text-muted">{section.hint}</p> : <div className="h-1" />}
            {open === "preset" ? (
              <>
                <p className="mb-2 text-xs text-muted">누르면 다른 조건은 지우고 이 조건만 적용합니다</p>
                <Quick items={presets} />
              </>
            ) : open === "months" ? (
              <Quick items={MONTHS.map((m) => ({ label: monthLabel(m), active: months === m, onClick: () => {
                    onMonths(m);
                    close();
                  } }))} />
            ) : section ? (
              <>
                {section.quick.length ? <Quick items={section.quick} /> : null}
                {section.range}
              </>
            ) : null}
          </div>
          {open !== "months" ? <ResultLine count={count} resultCount={resultCount} truncated={truncated} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function BarChip({
  label,
  value,
  icon,
  open,
  quiet = false,
  onClick,
  onClear,
}: {
  label: string;
  value: string | null;
  icon?: React.ReactNode;
  open: boolean;
  /** 늘 값이 있는 칩(기간)은 강조하지 않는다 */
  quiet?: boolean;
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
  onClear?: () => void;
}) {
  const on = value !== null && !quiet;
  return (
    <span
      className={clsx(
        "flex h-9 shrink-0 items-center rounded-full border text-sm",
        on ? "border-accent bg-accent-soft font-semibold text-accent" : open ? "border-text text-text" : "border-border text-text",
      )}
    >
      <button type="button" onClick={onClick} aria-expanded={open} className={clsx("flex h-full items-center gap-1 pl-3", on && onClear ? "pr-1" : "pr-2")}>
        {icon}
        {on ? value : quiet && value ? `${label} ${value}` : label}
        {on && onClear ? null : <ChevronDown size={13} className={clsx("text-muted transition-transform", open && "rotate-180")} />}
      </button>
      {on && onClear ? (
        <button type="button" aria-label={`${label} 조건 해제`} onClick={onClear} className="flex h-full items-center pl-0.5 pr-2.5">
          <X size={13} />
        </button>
      ) : null}
    </span>
  );
}

/** 전체 조건 패널(모든 조건을 한 화면에서) */
export function FilterPanel({
  filters,
  onChange,
  onSort,
  type,
  unit,
  kind,
  resultCount,
  truncated,
  onClose,
}: {
  filters: MapFilters;
  onChange: (f: MapFilters) => void;
  onSort: (s: SortKey) => void;
  type: string;
  unit: AreaUnit;
  kind: "sale" | "jeonse";
  resultCount: number;
  truncated: boolean;
  onClose: () => void;
}) {
  const sections = buildSections({ filters, onChange, type, unit, kind });
  const count = activeFilterCount(filters, type);
  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-xl border border-border bg-surface text-sm shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <b>전체 조건</b>
        <span className="flex items-center gap-3">
          {count ? (
            <button type="button" className="text-xs text-accent" onClick={() => onChange(EMPTY_FILTERS)}>
              초기화
            </button>
          ) : null}
          <button type="button" aria-label="닫기" onClick={onClose} className="text-muted">
            <X size={16} />
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-3">
        <div className="py-3">
          <p className="mb-1.5 text-xs font-medium text-muted">추천 조건</p>
          <Quick items={presetItems(filters, type, onChange, onSort)} />
        </div>
        {sections.map((s) => (
          <div key={s.key} className="py-3">
            <p className="mb-1.5 text-xs font-medium text-muted">
              {s.label}
              {s.hint ? <span className="ml-1 font-normal">· {s.hint}</span> : null}
            </p>
            {s.quick.length ? <Quick items={s.quick} /> : null}
            {s.range}
          </div>
        ))}
      </div>
      <ResultLine count={count} resultCount={resultCount} truncated={truncated} />
      <div className="border-t border-border p-2">
        <button type="button" onClick={onClose} className="h-10 w-full rounded-lg bg-accent text-sm font-semibold text-white">
          {resultCount.toLocaleString()}곳 보기
        </button>
      </div>
    </div>
  );
}
