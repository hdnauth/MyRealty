"use client";

import clsx from "clsx";
import { RANGES, type RangeKey } from "@/lib/chart-range";

export { defaultRange, rangeOptions, rangeSince, type RangeKey } from "@/lib/chart-range";

/** 차트 위 기간 버튼(1년·3년·5년·10년·전체) — 손가락으로 누르기 쉽게 hit 영역을 넓힌다 */
export function RangeChips({ options, value, onChange }: { options: RangeKey[]; value: RangeKey; onChange: (k: RangeKey) => void }) {
  if (options.length < 2) return null;
  return (
    <div className="mb-2 flex justify-end gap-1" role="group" aria-label="기간">
      {options.map((k) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={clsx(
            "hit h-8 min-w-10 rounded-lg px-2.5 text-xs",
            value === k ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-2",
          )}
        >
          {RANGES.find((r) => r.key === k)!.label}
        </button>
      ))}
    </div>
  );
}
