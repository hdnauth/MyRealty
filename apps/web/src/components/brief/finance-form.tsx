"use client";

import { useActionState, useState } from "react";
import { MoneyField } from "@/components/items/smart-inputs";
import { Button } from "@/components/ui";
import { saveFinanceProfileAction, type FinanceFormState } from "@/app/(main)/settings/actions";
import { DEFAULT_LTV, type FinanceProfile, LTV_OPTIONS } from "@/lib/brief";

/**
 * 내 자금(가용 현금·연소득·LTV). 한 번 넣으면 모든 매수 후보·관심 부동산과 단지 화면에서 "살 수 있나"를 계산한다.
 * compact: 요약 카드 안에서 바로 넣는 짧은 형태
 */
export function FinanceProfileForm({ profile, compact = false }: { profile: FinanceProfile | null; compact?: boolean }) {
  const [state, action, pending] = useActionState(saveFinanceProfileAction, {} as FinanceFormState);
  const [ltv, setLtv] = useState(profile?.ltv ?? DEFAULT_LTV);
  return (
    <form action={action} className={compact ? "space-y-3 rounded-xl bg-surface-2 p-3" : "space-y-4"}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MoneyField label="집 사는 데 쓸 수 있는 현금" name="cash" defaultValue={profile?.cash} placeholder="예) 3억 5000" />
        <MoneyField label="가구 연소득(세전)" name="income" defaultValue={profile?.income} placeholder="예) 8000만" />
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-muted">대출 비율(LTV) — 집값의 몇 %까지 빌릴 수 있나</span>
        <input type="hidden" name="ltv" value={ltv} />
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="LTV">
          {LTV_OPTIONS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={ltv === v}
              onClick={() => setLtv(v)}
              className={`rounded-full border px-3.5 py-1.5 text-sm ${ltv === v ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted hover:text-text"}`}
            >
              {Math.round(v * 100)}%
            </button>
          ))}
        </div>
        <span className="mt-1 block text-xs text-muted">규제지역·생애최초 여부·주택 수에 따라 다릅니다. 모르면 50%로 두세요.</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className={compact ? "h-9" : ""}>
          {pending ? "계산 중…" : profile ? "다시 계산" : "계산하기"}
        </Button>
        {state.error ? <span className="text-sm text-up">{state.error}</span> : null}
        {state.saved ? <span className="text-sm text-ok">저장했어요</span> : null}
        <span className="text-xs text-muted">이 기기(가입하면 계정)에만 저장되며, 다른 사람에게 보이지 않습니다.</span>
      </div>
    </form>
  );
}
