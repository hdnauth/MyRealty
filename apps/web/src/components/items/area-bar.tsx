"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setItemAreaAction } from "@/app/(main)/items/actions";

export type AreaOption = { area: number; label: string; trades: number };

/**
 * 단지형 관심 부동산의 평형 막대(개요·시세·주변 탭).
 * - 평형을 아직 안 골랐으면: 눌러서 바로 내 평형으로 저장
 * - 골랐으면(동·호로 정해진 경우 포함): 다른 평형을 눌러 '저장하지 않고' 그 평형 기준으로 보고, 원하면 저장
 */
export function AreaBar({
  itemId,
  tab,
  types,
  saved,
  viewing,
  dongHo,
}: {
  itemId: string;
  tab: string;
  types: AreaOption[];
  /** 저장된 내 평형(전용 ㎡) */
  saved: number | null;
  /** ?area= 로 보고 있는 평형 */
  viewing: number | null;
  dongHo: string | null;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const base = `/items/${itemId}${tab !== "overview" ? `?tab=${tab}` : ""}`;
  const viewHref = (a: number) => `/items/${itemId}?${tab !== "overview" ? `tab=${tab}&` : ""}area=${a.toFixed(2)}`;
  const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) <= 3;
  const save = (a: number) =>
    start(async () => {
      await setItemAreaAction(itemId, a);
      router.replace(base, { scroll: false });
    });

  if (saved === null && viewing === null) {
    return (
      <div className="card mb-4 border-warn/40 p-4">
        <div className="text-sm font-medium">평형을 골라 주세요</div>
        <p className="mt-0.5 text-xs text-muted">
          지금은 단지의 모든 평형 거래를 섞어 보여 줍니다. 내 평형을 고르면 시세·㎡당 가격·전세가율·층별 차이·추정 시세가 그 평형 기준으로 바뀝니다.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {types.map((t) => (
            <button
              key={t.area}
              type="button"
              disabled={pending}
              onClick={() => save(t.area)}
              className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {t.label} <span className="font-normal text-muted">· {t.trades}건</span>
            </button>
          ))}
          {pending ? <Loader2 size={14} className="animate-spin text-muted" /> : null}
        </div>
      </div>
    );
  }

  // ★ 는 저장된 면적과 가장 가까운 평형 하나에만(±3㎡ 안에 비슷한 타입이 둘 이상일 수 있다)
  const nearest = (a: number | null) =>
    a === null ? null : types.reduce<AreaOption | null>((b, t) => (near(a, t.area) && (!b || Math.abs(t.area - a) < Math.abs(b.area - a)) ? t : b), null);
  const mineType = nearest(saved);
  const activeType = nearest(viewing ?? saved);
  const other = viewing !== null && activeType !== mineType;
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted">평형</span>
        {types.map((t) => {
          const mine = t === mineType;
          const on = t === activeType;
          return (
            <Link
              key={t.area}
              href={mine ? base : viewHref(t.area)}
              scroll={false}
              aria-current={on ? "true" : undefined}
              className={clsx(
                "rounded-full border px-3.5 py-1.5 text-sm",
                on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border bg-surface text-muted hover:border-accent hover:text-accent",
              )}
            >
              {mine ? "★ " : ""}
              {t.label}
              <span className="font-normal opacity-70"> · {t.trades}건</span>
            </Link>
          );
        })}
      </div>
      {other ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-warn/10 px-3 py-2 text-xs">
          <span>
            <b>{activeType?.label ?? `${viewing}㎡`}</b> 기준으로 보는 중입니다(저장 안 됨). 추정 시세·알림은 내 평형 기준입니다.
          </span>
          <Link href={base} scroll={false} className="text-accent">
            내 평형으로 돌아가기
          </Link>
          <button type="button" disabled={pending} onClick={() => viewing !== null && save(viewing)} className="inline-flex items-center gap-1 text-accent disabled:opacity-50">
            {pending ? <Loader2 size={13} className="animate-spin" /> : null}이 평형을 내 평형으로 저장
          </button>
          {dongHo ? <span className="text-xs text-muted">동·호({dongHo})는 그대로 둡니다 — 수정 화면에서 바꿀 수 있습니다</span> : null}
        </div>
      ) : null}
    </div>
  );
}
