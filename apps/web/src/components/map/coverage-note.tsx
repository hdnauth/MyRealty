"use client";

import { Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { requestRegionAction, type RegionRequestResult } from "@/app/(main)/map/actions";
import type { Coverage } from "@/lib/coverage";

/** 미리보기 상태(지도 /api/map/live 응답 요약) */
export type LiveInfo = { n: number; total: number; level: "emd" | "complex"; limited: boolean; pending: number; loading: boolean };

const DISMISS_KEY = "mr.coverageDismissed";

function readDismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 수집 전 지역 안내. 예전에는 지도를 옮길 때마다 큰 카드("아직 실거래를 모으지 않은 지역")가 떴다 —
 * 이제는 공공데이터 미리보기 라벨을 지도에 바로 그리고, 여기서는 작은 칩으로 "미리보기"임을 알리고 수집 요청만 받는다.
 * 닫으면(×) 그 시군구에서는 이 기기에서 다시 띄우지 않는다.
 */
export function CoverageNote({ cov, live, center, compact = false }: { cov: Coverage | null; live: LiveInfo | null; center: [number, number] | null; compact?: boolean }) {
  const [result, setResult] = useState<RegionRequestResult | null>(null);
  const [pending, start] = useTransition();
  const [dismissed, setDismissed] = useState<string[]>(() => (typeof window === "undefined" ? [] : readDismissed()));
  if (!cov || (cov.collected && cov.ready)) return null;
  if (compact && dismissed.includes(cov.sgg)) return null;
  const dismiss = () => {
    const next = [...new Set([...dismissed, cov.sgg])].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* 저장 불가 — 이번 화면에서만 닫는다 */
    }
  };
  const started = cov.collected || (result?.ok && result.status === "enabled");
  const liveText = !live
    ? null
    : live.loading
      ? "최근 거래를 불러오는 중…"
      : live.limited && !live.n
        ? "오늘 미리보기 조회 한도를 다 썼어요"
        : live.total === 0
          ? "최근 3개월 거래가 없어요"
          : `최근 3개월 ${live.total.toLocaleString()}건 미리보기${live.level === "emd" ? " · 확대하면 단지별" : live.pending ? " · 단지 위치 찾는 중" : ""}`;
  const done = result?.ok && result.status !== undefined;
  return (
    <div
      className={compact ? "flex items-start gap-2 rounded-xl border border-border bg-surface/95 px-3 py-2 text-xs shadow-md" : "flex items-start gap-2 border-b border-border px-4 py-2.5 text-xs"}
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {cov.name} · {started ? "수집 시작됨(다음 매일 수집부터)" : "수집 전 지역"}
        </p>
        <p className="mt-0.5 text-muted">
          {live?.loading ? <Loader2 size={11} className="mr-1 inline animate-spin" /> : null}
          {liveText ?? "공공데이터를 바로 불러와 보여 줍니다"}
          {liveText && !live?.loading ? " — 공공데이터를 바로 조회(저장 전)" : ""}
        </p>
        {result ? <p className={`mt-1 ${result.ok ? "text-ok" : "text-up"}`}>{result.message}</p> : cov.pending ? <p className="mt-1 text-muted">수집 요청이 접수돼 운영자 확인을 기다리고 있어요.</p> : null}
        {!started && !done && !cov.pending && center ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setResult(await requestRegionAction(center[0], center[1])))}
            className="mt-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent px-2.5 font-medium text-accent disabled:opacity-60"
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : null}매일 수집 요청(지표·알림까지)
          </button>
        ) : null}
      </div>
      {compact ? (
        <button type="button" aria-label="닫기" onClick={dismiss} className="shrink-0 text-muted">
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
