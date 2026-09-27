"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui";
import { formatManwon, parseManwon } from "@/lib/format";
import { dongHo, parseDongHo } from "@/lib/units";

/**
 * 금액 입력: "15억 3000", "8500만", "150000"(만원) 모두 받고, 입력값을 "15억 3,000만" 처럼 바로 보여 준다.
 * 서버에는 원문이 가고 parseManwon 으로 읽는다.
 */
export function MoneyField({ label, name, defaultValue, placeholder = "예) 15억 3000" }: { label: string; name: string; defaultValue?: number | null; placeholder?: string }) {
  // 저장된 금액은 "15억 3,000만" 처럼 읽기 쉬운 형태로 채운다(parseManwon 이 그대로 읽는다)
  const [v, setV] = useState(defaultValue != null ? formatManwon(defaultValue) : "");
  const parsed = parseManwon(v);
  return (
    <Field
      label={label}
      hint={v ? (parsed === null ? <span className="text-up">금액을 읽을 수 없습니다 (예: 15억 3000, 8500만)</span> : `= ${formatManwon(parsed)}원`) : undefined}
    >
      <Input name={name} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} autoComplete="off" />
    </Field>
  );
}

function floorText(f: number) {
  return f < 0 ? `지하 ${-f}층` : `${f}층`;
}

/**
 * 층: 호수에서 자동으로 채우고(903호 → 9층), 복층·상가처럼 규칙이 다를 때만 직접 고친다.
 * derived 가 바뀌면(다른 호를 고르면) 직접 입력한 값은 유지한다.
 */
export function FloorField({ derived, initial }: { derived: number | null; initial?: number | null }) {
  // 저장된 층이 저장된 호수의 규칙과 다르면 직접 입력한 것으로 본다(호 없이 저장된 층은 새로 넣은 호수를 따른다)
  const [manual, setManual] = useState<string | null>(initial != null && derived != null && initial !== derived ? String(initial) : null);
  const auto = derived ?? initial ?? null;
  const value = manual ?? (auto != null ? String(auto) : "");
  return (
    <div className="text-sm">
      <input type="hidden" name="floor" value={value} />
      {manual === null ? (
        <p className="flex flex-wrap items-center gap-x-2 text-muted">
          {derived != null ? (
            <span>
              <b className="text-text">{floorText(derived)}</b> · 호수에서 자동
            </span>
          ) : initial != null ? (
            <span>
              <b className="text-text">{floorText(initial)}</b> · 저장된 값(호수를 넣으면 호수 기준으로 바뀝니다)
            </span>
          ) : (
            <span>층은 호수를 넣으면 자동으로 채워집니다</span>
          )}
          <button type="button" className="text-xs text-accent underline-offset-2 hover:underline" onClick={() => setManual(value)}>
            층 직접 입력
          </button>
        </p>
      ) : (
        <div className="flex items-center gap-2 whitespace-nowrap">
          <div className="w-24">
            <Input inputMode="numeric" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="층" aria-label="층" />
          </div>
          <span className="text-muted">층</span>
          <button type="button" className="text-xs text-accent" onClick={() => setManual(null)}>
            {derived != null ? `호수 기준(${floorText(derived)})으로` : "지우기"}
          </button>
        </div>
      )}
    </div>
  );
}

/** 동·호 한 칸 입력("101동 903호", "101-903", "903") + 층 자동 */
export function DongHoField({ defaultValue, defaultFloor }: { defaultValue?: string | null; defaultFloor?: number | null }) {
  const [raw, setRaw] = useState(defaultValue ?? "");
  const p = parseDongHo(raw);
  const normalized = p.ho || p.dong ? dongHo(p.dong ?? "", p.ho ?? "") : raw.trim();
  return (
    <div className="space-y-1.5">
      <Field label="동·호">
        <Input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="예) 101동 903호, 101-903, 903" autoComplete="off" />
      </Field>
      <input type="hidden" name="dong_ho" value={normalized} />
      <FloorField derived={p.floor} initial={defaultFloor} />
    </div>
  );
}

/** 몇 개 중 하나 고르기(셀렉트 대신 칩). 값은 hidden input 으로 보낸다 */
export function ChoiceChips({
  name,
  label,
  options,
  defaultValue,
  hint,
}: {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue: string;
  hint?: string;
}) {
  const [v, setV] = useState(defaultValue);
  const opts = options.some((o) => o.value === defaultValue) ? options : [...options, { value: defaultValue, label: defaultValue }];
  return (
    <div>
      <span className="mb-1 block text-[13px] font-medium text-muted">{label}</span>
      <input type="hidden" name={name} value={v} />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {opts.map((o) => (
          <button
            type="button"
            key={o.value}
            role="radio"
            aria-checked={v === o.value}
            onClick={() => setV(o.value)}
            className={`rounded-full border px-3 py-1.5 text-[13px] ${v === o.value ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted hover:text-text"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export const RADIUS_OPTIONS = [
  { value: "500", label: "500m" },
  { value: "1000", label: "1km" },
  { value: "2000", label: "2km" },
  { value: "3000", label: "3km" },
] as const;
