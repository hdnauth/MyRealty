"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { requestRegionAction, type RegionRequestResult } from "@/app/(main)/map/actions";
import type { Coverage } from "@/lib/coverage";

/**
 * 지도 화면에 거래가 하나도 없을 때: 그 시군구가 아직 수집 대상이 아니면 "이 지역 데이터 모으기"를 보인다.
 * 수집 중인 지역이면 아무것도 그리지 않는다(목록의 "거래 없음" 문구가 대신한다).
 */
export function CoverageNote({ center, active, compact = false }: { center: [number, number] | null; active: boolean; compact?: boolean }) {
  const [cov, setCov] = useState<{ key: string; value: Coverage | null } | null>(null);
  const [result, setResult] = useState<RegionRequestResult | null>(null);
  const [pending, start] = useTransition();
  const key = center ? `${center[0].toFixed(2)},${center[1].toFixed(2)}` : null;

  useEffect(() => {
    if (!active || !key || !center) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/map/coverage?lng=${center[0].toFixed(4)}&lat=${center[1].toFixed(4)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((d) => setCov({ key, value: d.coverage ?? null }))
        .catch(() => {});
    }, 500);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // center 는 key(약 1km 격자)가 바뀔 때만 다시 묻는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);

  const c = cov && cov.key === key ? cov.value : null;
  if (!active || !c || (c.collected && c.ready)) return null;
  const box = compact ? "rounded-xl border border-accent/30 bg-surface p-3 text-sm shadow-md" : "p-4 text-sm";
  if (c.collected || (result?.ok && result.status === "enabled")) {
    // 수집을 막 켠 지역(요청 직후·다른 사람이 요청한 곳): 아직 모은 거래가 없다
    return (
      <div className={box} role="status">
        <p className="font-semibold">{c.name} 실거래를 모으기 시작했어요</p>
        <p className="mt-0.5 text-[13px] text-muted">{result?.message ?? "다음 매일 수집(보통 다음 날 아침) 뒤 최근 거래부터 지도에 나타나요."}</p>
      </div>
    );
  }
  const done = result?.ok && result.status !== undefined;
  return (
    <div className={box} role="status">
      <p className="font-semibold">{c.name}은(는) 아직 실거래를 모으지 않은 지역이에요</p>
      <p className="mt-0.5 text-[13px] text-muted">
        마이리얼티는 사용자가 관심을 둔 지역부터 공공데이터를 모읍니다. 요청하면 다음 매일 수집 때 최근 거래부터 채워요.
      </p>
      {result ? (
        <p className={`mt-2 text-[13px] ${result.ok ? "text-ok" : "text-up"}`}>{result.message}</p>
      ) : c.pending ? (
        <p className="mt-2 text-[13px] text-muted">이미 요청이 접수돼 운영자 확인을 기다리고 있어요.</p>
      ) : null}
      {!done && !c.pending ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setResult(await requestRegionAction(center![0], center![1])))}
          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : null}이 지역 데이터 모으기
        </button>
      ) : null}
    </div>
  );
}
