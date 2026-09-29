"use client";

import { Loader2 } from "lucide-react";
import { useTransition } from "react";
import { setItemAreaAction } from "@/app/(main)/items/actions";

/** 평형을 고르지 않은 단지형 부동산: 이 단지의 거래 평형을 눌러 바로 정한다 */
export function AreaChoice({ itemId, types }: { itemId: string; types: { area: number; label: string; trades: number }[] }) {
  const [pending, start] = useTransition();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {types.map((t) => (
        <button
          key={t.area}
          type="button"
          disabled={pending}
          onClick={() => start(() => setItemAreaAction(itemId, t.area))}
          className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {t.label} <span className="font-normal text-muted">· {t.trades}건</span>
        </button>
      ))}
      {pending ? <Loader2 size={14} className="animate-spin text-muted" /> : null}
    </div>
  );
}
