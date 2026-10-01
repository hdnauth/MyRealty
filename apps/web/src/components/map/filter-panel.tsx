"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import { useState } from "react";
import { type AreaUnit, M2_PER_PYEONG } from "@/lib/format";
import { activeFilterCount, COMPLEX_TYPES, EMPTY_FILTERS, FILTER_PRESETS, type MapFilters, SORTS, type SortKey } from "@/lib/map-filters";

/*
 * 지도 후보 탐색 조건. 값은 기준 단위(만원·평당 만원·㎡·비율)로 갖고, 입력 칸만 보기 좋은 단위(억·설정 면적 단위·%)로 바꿔 보여 준다.
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
      className="h-8 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-sm tabular outline-none focus:border-accent"
    />
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <p className="mb-1 text-xs font-medium text-muted">
        {label}
        {hint ? <span className="ml-1 font-normal">· {hint}</span> : null}
      </p>
      {children}
    </div>
  );
}

function Range({ min, max, onMin, onMax, scale, unit }: { min: number | null; max: number | null; onMin: (v: number | null) => void; onMax: (v: number | null) => void; scale: Scale; unit: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <NumInput value={min} onChange={onMin} scale={scale} placeholder="최소" />
      <span className="text-muted">~</span>
      <NumInput value={max} onChange={onMax} scale={scale} placeholder="최대" />
      <span className="w-12 shrink-0 text-xs text-muted">{unit}</span>
    </div>
  );
}

function Quick({ items }: { items: { label: string; active: boolean; onClick: () => void }[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.map((q) => (
        <button
          key={q.label}
          type="button"
          onClick={q.onClick}
          className={clsx("rounded-full border px-2 py-0.5 text-[12px]", q.active ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted hover:text-text")}
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}

export function FilterPanel({
  filters,
  onChange,
  sort,
  onSort,
  type,
  unit,
  resultCount,
  truncated,
  onClose,
}: {
  filters: MapFilters;
  onChange: (f: MapFilters) => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  type: string;
  unit: AreaUnit;
  resultCount: number;
  truncated: boolean;
  onClose: () => void;
}) {
  const complex = COMPLEX_TYPES.has(type);
  const year = new Date().getFullYear();
  const set = (patch: Partial<MapFilters>) => onChange({ ...filters, ...patch });
  // 같은 값을 다시 누르면 끈다
  const toggle = (patch: Partial<MapFilters>) => {
    const on = (Object.keys(patch) as (keyof MapFilters)[]).every((k) => filters[k] === patch[k]);
    set(on ? Object.fromEntries(Object.keys(patch).map((k) => [k, null])) : patch);
  };
  const is = (patch: Partial<MapFilters>) => (Object.keys(patch) as (keyof MapFilters)[]).every((k) => filters[k] === patch[k]);
  const pyeong = unit === "pyeong";
  const areaScale: Scale = pyeong ? { toView: (v) => v / M2_PER_PYEONG, fromView: (v) => v * M2_PER_PYEONG, digits: 1 } : { ...id, digits: 1 };
  const ppyScale: Scale = pyeong ? id : { toView: (v) => v / M2_PER_PYEONG, fromView: (v) => v * M2_PER_PYEONG, digits: 0 };
  const count = activeFilterCount(filters, type);
  const areaQuick: [string, number | null, number | null][] = complex
    ? [
        ["소형 ~60㎡", null, 60],
        ["중형 60~85㎡", 60, 85],
        ["중대형 85~135㎡", 85, 135],
        ["대형 135㎡~", 135, null],
      ]
    : [
        ["~330㎡(100평)", null, 330],
        ["330~1,000㎡", 330, 1000],
        ["1,000~3,300㎡", 1000, 3300],
        ["3,300㎡(1천평)~", 3300, null],
      ];

  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-xl border border-border bg-surface text-sm shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <b>조건으로 찾기</b>
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
        <Row label="빠른 조건">
          <Quick
            items={FILTER_PRESETS.filter((p) => complex || !p.complexOnly).map((p) => {
              const patch = p.filters(year);
              return {
                label: p.label,
                active: count === Object.keys(patch).length && is(patch),
                onClick: () => {
                  onChange({ ...EMPTY_FILTERS, ...patch });
                  if (p.sort) onSort(p.sort);
                },
              };
            })}
          />
        </Row>
        <Row label="정렬 · 라벨 지표">
          <select value={sort} onChange={(e) => onSort(e.target.value as SortKey)} className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm">
            {SORTS.filter((s) => complex || !s.complexOnly).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="가격(중위)" hint="고른 거래 유형·기간 기준">
          <Range min={filters.priceMin} max={filters.priceMax} onMin={(v) => set({ priceMin: v })} onMax={(v) => set({ priceMax: v })} scale={eok} unit="억" />
          <Quick
            items={[
              ["~3억", null, 30_000],
              ["3~6억", 30_000, 60_000],
              ["6~10억", 60_000, 100_000],
              ["10~15억", 100_000, 150_000],
              ["15억~", 150_000, null],
            ].map(([label, lo, hi]) => ({
              label: label as string,
              active: is({ priceMin: lo as number | null, priceMax: hi as number | null }),
              onClick: () => toggle({ priceMin: lo as number | null, priceMax: hi as number | null }),
            }))}
          />
        </Row>
        <Row label={pyeong ? "평당가(중위)" : "㎡당 가격(중위)"}>
          <Range min={filters.ppyMin} max={filters.ppyMax} onMin={(v) => set({ ppyMin: v })} onMax={(v) => set({ ppyMax: v })} scale={ppyScale} unit={pyeong ? "만원/평" : "만원/㎡"} />
        </Row>
        <Row label={complex ? "전용면적" : "면적(토지·연면적)"} hint="이 면적의 거래만 집계">
          <Range min={filters.areaMin} max={filters.areaMax} onMin={(v) => set({ areaMin: v })} onMax={(v) => set({ areaMax: v })} scale={areaScale} unit={pyeong ? "평" : "㎡"} />
          <Quick items={areaQuick.map(([label, lo, hi]) => ({ label, active: is({ areaMin: lo, areaMax: hi }), onClick: () => toggle({ areaMin: lo, areaMax: hi }) }))} />
        </Row>
        {complex ? (
          <Row label="준공 연도">
            <Range min={filters.yearMin} max={filters.yearMax} onMin={(v) => set({ yearMin: v })} onMax={(v) => set({ yearMax: v })} scale={id} unit="년" />
            <Quick
              items={[
                ["5년 이내", year - 5, null],
                ["10년 이내", year - 10, null],
                ["20년 이내", year - 20, null],
                ["30년 이상", null, year - 30],
              ].map(([label, lo, hi]) => ({
                label: label as string,
                active: is({ yearMin: lo as number | null, yearMax: hi as number | null }),
                onClick: () => toggle({ yearMin: lo as number | null, yearMax: hi as number | null }),
              }))}
            />
          </Row>
        ) : null}
        <Row label="전세가율" hint="최근 12개월 ㎡당 전세 ÷ 매매">
          <Range min={filters.jrMin} max={filters.jrMax} onMin={(v) => set({ jrMin: v })} onMax={(v) => set({ jrMax: v })} scale={pct} unit="%" />
          <Quick
            items={[
              ["50% 이하", null, 0.5],
              ["60%+", 0.6, null],
              ["70%+", 0.7, null],
              ["80%+ (깡통 주의)", 0.8, null],
            ].map(([label, lo, hi]) => ({
              label: label as string,
              active: is({ jrMin: lo as number | null, jrMax: hi as number | null }),
              onClick: () => toggle({ jrMin: lo as number | null, jrMax: hi as number | null }),
            }))}
          />
        </Row>
        <Row label="1년 가격 변화" hint="최근 6개월 vs 1년 전 같은 기간 ㎡당 중위">
          <Range min={filters.chgMin} max={filters.chgMax} onMin={(v) => set({ chgMin: v })} onMax={(v) => set({ chgMax: v })} scale={pct} unit="%" />
          <Quick
            items={[
              ["하락", null, 0],
              ["상승", 0, null],
              ["+5% 이상", 0.05, null],
              ["+10% 이상", 0.1, null],
            ].map(([label, lo, hi]) => ({
              label: label as string,
              active: is({ chgMin: lo as number | null, chgMax: hi as number | null }),
              onClick: () => toggle({ chgMin: lo as number | null, chgMax: hi as number | null }),
            }))}
          />
        </Row>
        {complex ? (
          <>
            <Row label="세대수" hint="건축물대장을 불러온 단지만 남습니다">
              <Quick items={[300, 500, 1000].map((v) => ({ label: `${v.toLocaleString()}세대+`, active: filters.hhMin === v, onClick: () => toggle({ hhMin: v }) }))} />
            </Row>
            <Row label="입지 점수" hint="점수를 계산한 단지만 남습니다">
              <Quick items={[60, 70, 80].map((v) => ({ label: `${v}점+`, active: filters.locMin === v, onClick: () => toggle({ locMin: v }) }))} />
            </Row>
          </>
        ) : null}
      </div>
      <div className="border-t border-border px-3 py-2 text-xs text-muted">
        {count ? `조건 ${count}개 · ` : ""}이 화면에서 {resultCount.toLocaleString()}곳
        {truncated ? " (최대 400곳 — 지도를 확대하면 더 정확합니다)" : ""}
      </div>
    </div>
  );
}
