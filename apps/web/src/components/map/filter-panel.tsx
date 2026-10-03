"use client";

import clsx from "clsx";
import { ChevronDown, RotateCcw, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type AreaUnit, formatManwon, M2_PER_PYEONG } from "@/lib/format";
import { activeFilterCount, CATEGORY_GROUPS, type DealKind, EMPTY_FILTERS, filterApplies, type MapFilters, presetsFor, sameFilters, type SortKey, ZONE_GROUPS } from "@/lib/map-filters";
import { MAP_MONTHS } from "@/lib/map-prefs";

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

type QuickItem = { label: string; active: boolean; onClick: () => void; /** 누르기 전에 알면 좋은 설명(마우스를 올리면) */ hint?: string };

function Quick({ items }: { items: QuickItem[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((q) => (
        <button
          key={q.label}
          type="button"
          title={q.hint}
          aria-pressed={q.active}
          onClick={q.onClick}
          className={clsx("rounded-full border px-3 py-1.5 text-sm", q.active ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-text hover:bg-surface-2")}
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}

/** 묶음 설명(휴대폰은 마우스 올리기가 없어 글로 보여 준다) */
function PresetHints({ items }: { items: QuickItem[] }) {
  const hints = items.filter((q) => q.hint);
  if (!hints.length) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted">
      {hints.map((q) => (
        <li key={q.label} className={clsx(q.active && "font-medium text-accent")}>
          · {q.label}: {q.hint}
        </li>
      ))}
    </ul>
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

type SectionKey = "price" | "rent" | "yield" | "area" | "cats" | "zones" | "share" | "bldg" | "floor" | "year" | "hh" | "jr" | "chg" | "loc" | "ppy";

/** 유형별 조건 순서 — 그 유형에서 먼저 따지는 것부터(토지는 지목·용도지역, 상가는 용도·층, 오피스텔은 월세·수익률) */
const ORDER: Record<string, SectionKey[]> = {
  apt: ["price", "rent", "area", "year", "hh", "jr", "chg", "loc", "yield", "ppy"],
  officetel: ["price", "rent", "yield", "area", "year", "jr", "chg", "loc", "ppy"],
  rowhouse: ["price", "rent", "jr", "year", "area", "yield", "chg", "ppy"],
  house: ["price", "rent", "cats", "year", "area", "ppy", "chg"],
  land: ["cats", "zones", "share", "ppy", "price", "area", "chg"],
  commercial: ["cats", "bldg", "floor", "zones", "share", "ppy", "price", "area", "year", "chg"],
};
/** 칩 줄에 값이 없어도 늘 보이는 단위가격 조건(토지·상가는 단위가격이 곧 시세) */
const PPY_CHIP = new Set(["land", "commercial", "house"]);

/** 섹션 → 그 섹션의 대표 조건(유형·거래 종류에 맞는지 판단) */
const SECTION_FILTER: Record<SectionKey, keyof MapFilters> = {
  price: "priceMin",
  rent: "rentMax",
  yield: "yieldMin",
  area: "areaMin",
  cats: "cats",
  zones: "zones",
  share: "noShare",
  bldg: "bldg",
  floor: "floor",
  year: "yearMin",
  hh: "hhMin",
  jr: "jrMin",
  chg: "chgMin",
  loc: "locMin",
  ppy: "ppyMin",
};

const AREA_QUICK: Record<string, [string, number | null, number | null][]> = {
  apt: [
    ["소형 ~60㎡", null, 60],
    ["국민평형 84㎡", 80, 90],
    ["중형 60~85㎡", 60, 85],
    ["중대형 85~135㎡", 85, 135],
    ["대형 135㎡~", 135, null],
  ],
  officetel: [
    ["원룸 ~20㎡", null, 20],
    ["1.5룸 20~40㎡", 20, 40],
    ["투룸 40~60㎡", 40, 60],
    ["60㎡~(아파텔)", 60, null],
  ],
  rowhouse: [
    ["~40㎡", null, 40],
    ["40~60㎡", 40, 60],
    ["60~85㎡", 60, 85],
    ["85㎡~", 85, null],
  ],
  house: [
    ["~100㎡", null, 100],
    ["100~200㎡", 100, 200],
    ["200~330㎡", 200, 330],
    ["330㎡(100평)~", 330, null],
  ],
  land: [
    ["~330㎡(100평)", null, 330],
    ["330~1,000㎡", 330, 1000],
    ["1,000~3,300㎡", 1000, 3300],
    ["3,300㎡(1천평)~", 3300, null],
  ],
  commercial: [
    ["~33㎡(10평)", null, 33],
    ["33~66㎡", 33, 66],
    ["66~165㎡", 66, 165],
    ["165㎡(50평)~", 165, null],
  ],
};
const AREA_LABEL: Record<string, [string, string]> = {
  apt: ["평형", "전용면적 · 이 면적의 거래만 집계"],
  officetel: ["면적", "전용면적 · 이 면적의 거래만 집계"],
  rowhouse: ["면적", "전용면적 · 이 면적의 거래만 집계"],
  house: ["연면적", "건물 연면적 · 이 면적의 거래만 집계"],
  land: ["면적", "거래 토지면적 · 이 면적의 거래만 집계"],
  commercial: ["면적", "건물(전용)면적 · 이 면적의 거래만 집계"],
};
const PPY_LABEL: Record<string, string> = { house: "대지 ", land: "토지 ", commercial: "건물 " };

/** 목록 값 → "대지", "대지 외 2" */
const listText = (keys: string[], labels: { key: string; label: string }[]) => {
  if (!keys.length) return null;
  const first = labels.find((l) => l.key === keys[0])?.label ?? keys[0];
  return keys.length > 1 ? `${first.replace(/\(.*\)/, "")} 외 ${keys.length - 1}` : first;
};

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
  kind: DealKind;
  /** 빠른 값을 고른 뒤(칩 팝오버는 닫는다) */
  onPicked?: () => void;
}): Section[] {
  const year = new Date().getFullYear();
  const set = (patch: Partial<MapFilters>) => onChange({ ...filters, ...patch });
  const is = (patch: Partial<MapFilters>) => (Object.keys(patch) as (keyof MapFilters)[]).every((k) => filters[k] === patch[k]);
  // 같은 값을 다시 누르면 끈다
  const toggle = (patch: Partial<MapFilters>) => {
    set(is(patch) ? Object.fromEntries(Object.keys(patch).map((k) => [k, (EMPTY_FILTERS as Record<string, unknown>)[k]])) : patch);
    onPicked?.();
  };
  const quick = <K extends keyof MapFilters>(lo: K, hi: K | null, opts: [string, number | null, number | null][]): QuickItem[] =>
    opts.map(([label, a, b]) => {
      const patch = (hi ? { [lo]: a, [hi]: b } : { [lo]: a }) as Partial<MapFilters>;
      return { label, active: is(patch), onClick: () => toggle(patch) };
    });
  // 여러 개 고르는 목록(지목·용도지역): 누를 때마다 넣고 빼며, 팝오버는 열어 둔다
  const multi = (k: "cats" | "zones", opts: { key: string; label: string }[]): QuickItem[] =>
    opts.map((o) => {
      const on = filters[k].includes(o.key);
      return { label: o.label, active: on, onClick: () => set({ [k]: on ? filters[k].filter((x) => x !== o.key) : [...filters[k], o.key] }) };
    });
  const summary = (items: QuickItem[], text: string | null) => (text === null ? null : (items.find((q) => q.active)?.label ?? text));
  const pyeong = unit === "pyeong";
  const areaScale: Scale = pyeong ? { toView: (v) => v / M2_PER_PYEONG, fromView: (v) => v * M2_PER_PYEONG, digits: 1 } : { ...id, digits: 1 };
  const ppyScale: Scale = pyeong ? id : { toView: (v) => v / M2_PER_PYEONG, fromView: (v) => v * M2_PER_PYEONG, digits: 0 };
  const eokText = (v: number) => formatManwon(v, { short: true });
  const pctText = (v: number) => `${round(v * 100, 0)}%`;

  const price = quick(
    "priceMin",
    "priceMax",
    kind === "wolse"
      ? [
          ["보증금 ~500만", null, 500],
          ["~1천만", null, 1000],
          ["~3천만", null, 3000],
          ["~5천만", null, 5000],
        ]
      : type === "land" || type === "commercial" || type === "officetel"
        ? [
            ["~1억", null, 10_000],
            ["1~3억", 10_000, 30_000],
            ["3~5억", 30_000, 50_000],
            ["5~10억", 50_000, 100_000],
            ["10억~", 100_000, null],
          ]
        : [
            ["~3억", null, 30_000],
            ["3~6억", 30_000, 60_000],
            ["6~10억", 60_000, 100_000],
            ["10~15억", 100_000, 150_000],
            ["15억~", 150_000, null],
          ],
  );
  const rent = quick("rentMax", null, [
    ["~40만", 40, null],
    ["~60만", 60, null],
    ["~80만", 80, null],
    ["~100만", 100, null],
  ]);
  const yld = quick("yieldMin", null, [
    ["3%+", 0.03, null],
    ["4%+", 0.04, null],
    ["5%+", 0.05, null],
    ["6%+", 0.06, null],
  ]);
  const area = quick("areaMin", "areaMax", AREA_QUICK[type] ?? AREA_QUICK.apt);
  const catGroups = CATEGORY_GROUPS[type as keyof typeof CATEGORY_GROUPS] ?? [];
  const cats = multi("cats", catGroups);
  const zones = multi("zones", ZONE_GROUPS);
  const bldg = ([
    ["집합(구분 상가)", "집합"],
    ["일반(통건물)", "일반"],
  ] as const).map(([label, v]) => ({ label, active: filters.bldg === v, onClick: () => toggle({ bldg: v }) }));
  const floor = ([
    ["1층", "ground"],
    ["2층 이상", "upper"],
  ] as const).map(([label, v]) => ({ label, active: filters.floor === v, onClick: () => toggle({ floor: v }) }));
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
  const [areaLabel, areaHint] = AREA_LABEL[type] ?? AREA_LABEL.apt;

  const all: Record<SectionKey, Section> = {
    price: {
      key: "price",
      label: kind === "wolse" ? "보증금" : kind === "jeonse" ? "전세가" : "매매가",
      hint: "중위 가격 · 고른 기간 기준",
      summary: summary(price, rangeText(filters.priceMin, filters.priceMax, eokText)),
      clear: () => set({ priceMin: null, priceMax: null }),
      quick: price,
      range: <Range min={filters.priceMin} max={filters.priceMax} onMin={(v) => set({ priceMin: v })} onMax={(v) => set({ priceMax: v })} scale={eok} unit="억" />,
    },
    rent: {
      key: "rent",
      label: "월세",
      hint: "월세 중위 이하 · 고른 기간 기준",
      summary: filters.rentMax === null ? null : `월 ${filters.rentMax}만 이하`,
      clear: () => set({ rentMax: null }),
      quick: rent,
      range: <Range min={null} max={filters.rentMax} onMin={() => {}} onMax={(v) => set({ rentMax: v })} scale={id} unit="만원" />,
    },
    yield: {
      key: "yield",
      label: "임대수익률",
      hint: "최근 1년 월세×12 ÷ (매매가 − 월세 보증금) · 세금·관리비 빼기 전 추정치",
      summary: filters.yieldMin === null ? null : `수익률 ${pctText(filters.yieldMin)}+`,
      clear: () => set({ yieldMin: null }),
      quick: yld,
    },
    area: {
      key: "area",
      label: areaLabel,
      hint: areaHint,
      summary: summary(area, rangeText(filters.areaMin, filters.areaMax, areaText)),
      clear: () => set({ areaMin: null, areaMax: null }),
      quick: area,
      range: <Range min={filters.areaMin} max={filters.areaMax} onMin={(v) => set({ areaMin: v })} onMax={(v) => set({ areaMax: v })} scale={areaScale} unit={areaUnit} />,
    },
    cats: {
      key: "cats",
      label: type === "land" ? "지목" : type === "house" ? "주택 유형" : "건물 용도",
      hint: "여러 개 고를 수 있어요",
      summary: listText(filters.cats, catGroups),
      clear: () => set({ cats: [] }),
      quick: cats,
    },
    zones: {
      key: "zones",
      label: "용도지역",
      hint: "여러 개 고를 수 있어요 · 계획관리·자연녹지처럼 개발 가능 범위가 다릅니다",
      summary: listText(filters.zones, ZONE_GROUPS),
      clear: () => set({ zones: [] }),
      quick: zones,
    },
    share: {
      key: "share",
      label: "지분거래",
      hint: "한 필지를 여럿이 나눠 사는 지분 거래는 기획부동산 판매가 많아 시세를 왜곡합니다",
      summary: filters.noShare ? "지분 제외" : null,
      clear: () => set({ noShare: false }),
      quick: [{ label: "지분거래 빼기", active: filters.noShare, onClick: () => toggle({ noShare: true }) }],
    },
    bldg: {
      key: "bldg",
      label: "건물",
      hint: "집합은 호수별로 파는 구분 상가, 일반은 건물 전체(통건물) 거래",
      summary: filters.bldg === "집합" ? "구분 상가" : filters.bldg === "일반" ? "통건물" : null,
      clear: () => set({ bldg: null }),
      quick: bldg,
    },
    floor: {
      key: "floor",
      label: "층",
      hint: "층은 구분 상가(집합) 거래에만 있습니다 · 1층은 보통 상층의 2배 이상",
      summary: filters.floor === "ground" ? "1층" : filters.floor === "upper" ? "2층 이상" : null,
      clear: () => set({ floor: null }),
      quick: floor,
    },
    year: {
      key: "year",
      label: "준공",
      summary: summary(built, rangeText(filters.yearMin, filters.yearMax, (v) => `${v}년`)),
      clear: () => set({ yearMin: null, yearMax: null }),
      quick: built,
      range: <Range min={filters.yearMin} max={filters.yearMax} onMin={(v) => set({ yearMin: v })} onMax={(v) => set({ yearMax: v })} scale={id} unit="년" />,
    },
    hh: {
      key: "hh",
      label: "세대수",
      hint: "건축물대장을 불러온 단지만 남습니다",
      summary: summary(hh, filters.hhMin === null ? null : `${filters.hhMin.toLocaleString()}세대+`),
      clear: () => set({ hhMin: null }),
      quick: hh,
    },
    jr: {
      key: "jr",
      label: "전세가율",
      hint: "최근 12개월 ㎡당 전세 ÷ 매매",
      summary: summary(jr, rangeText(filters.jrMin, filters.jrMax, pctText)),
      clear: () => set({ jrMin: null, jrMax: null }),
      quick: jr,
      range: <Range min={filters.jrMin} max={filters.jrMax} onMin={(v) => set({ jrMin: v })} onMax={(v) => set({ jrMax: v })} scale={pct} unit="%" />,
    },
    chg: {
      key: "chg",
      label: "1년 변동",
      hint: "최근 6개월 vs 1년 전 같은 기간 ㎡당 중위",
      summary: summary(chg, rangeText(filters.chgMin, filters.chgMax, pctText)),
      clear: () => set({ chgMin: null, chgMax: null }),
      quick: chg,
      range: <Range min={filters.chgMin} max={filters.chgMax} onMin={(v) => set({ chgMin: v })} onMax={(v) => set({ chgMax: v })} scale={pct} unit="%" />,
    },
    loc: {
      key: "loc",
      label: "입지",
      hint: "점수를 계산한 단지만 남습니다",
      summary: summary(loc, filters.locMin === null ? null : `${filters.locMin}점+`),
      clear: () => set({ locMin: null }),
      quick: loc,
    },
    ppy: {
      key: "ppy",
      label: `${PPY_LABEL[type] ?? ""}${pyeong ? "평당가" : "㎡당 가격"}`,
      hint: type === "house" ? "대지면적 기준(단독은 땅값으로 비교)" : undefined,
      summary: rangeText(filters.ppyMin, filters.ppyMax, (v) => formatManwon(ppyScale.toView(v), { short: true })),
      clear: () => set({ ppyMin: null, ppyMax: null }),
      quick: [],
      range: <Range min={filters.ppyMin} max={filters.ppyMax} onMin={(v) => set({ ppyMin: v })} onMax={(v) => set({ ppyMax: v })} scale={ppyScale} unit={pyeong ? "만원/평" : "만원/㎡"} />,
    },
  };
  return (ORDER[type] ?? ORDER.apt).filter((k) => filterApplies(SECTION_FILTER[k], type, kind)).map((k) => all[k]);
}

function presetItems(filters: MapFilters, type: string, onChange: (f: MapFilters) => void, onSort: (s: SortKey) => void, onPicked?: () => void): QuickItem[] {
  const year = new Date().getFullYear();
  return presetsFor(type).map((p) => {
    const target = { ...EMPTY_FILTERS, ...p.filters(year) };
    // 이 묶음의 값만 켜져 있을 때
    const active = sameFilters(filters, target);
    return {
      label: p.label,
      hint: p.hint,
      active,
      onClick: () => {
        onChange(active ? EMPTY_FILTERS : target);
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
  kind: DealKind;
  months: number;
  onMonths: (m: number) => void;
  resultCount: number;
  truncated: boolean;
  onOpenAll: () => void;
};

const MONTHS = MAP_MONTHS;
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
  const count = activeFilterCount(filters, type, kind);
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
          .filter((s) => s.key !== "ppy" || s.summary || PPY_CHIP.has(type))
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
                <p className="mb-2 text-xs text-muted">이 유형에서 많이 찾는 조건이에요 · 누르면 다른 조건은 지우고 이것만 적용합니다</p>
                <Quick items={presets} />
                <PresetHints items={presets} />
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
  kind: DealKind;
  resultCount: number;
  truncated: boolean;
  onClose: () => void;
}) {
  const sections = buildSections({ filters, onChange, type, unit, kind });
  const count = activeFilterCount(filters, type, kind);
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
          <PresetHints items={presetItems(filters, type, onChange, onSort)} />
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
