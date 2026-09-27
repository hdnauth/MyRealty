import { CheckCircle2, Clock } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui";
import { PROPERTY_TYPES } from "@/lib/property";
import type { ItemDataStatus, WatchItem } from "@/lib/queries/items";

/**
 * 등록 직후(또는 아직 비어 있는 데이터가 있을 때) 지금 볼 수 있는 것과 다음 수집 때 채워질 것을 알려 준다.
 * ETL 은 매일 아침(06시 전후) 관심 부동산이 있는 시군구를 수집한다.
 */
export function DataStatusCard({ item, st, welcome }: { item: WatchItem; st: ItemDataStatus; welcome: boolean }) {
  const isLand = item.property_type === "land" || item.property_type === "forest";
  const hasComplex = PROPERTY_TYPES[item.property_type].hasComplex;
  const rows: { ok: boolean; label: string; ready: string; later: string; href?: string }[] = [
    hasComplex
      ? { ok: st.trades > 0, label: "실거래", ready: `${st.trades.toLocaleString()}건 연결됨`, later: "다음 수집 때 이 단지 거래를 연결합니다", href: "?tab=price" }
      : { ok: true, label: "주변 유사 거래", ready: "같은 동네·유사 면적 거래로 비교합니다", later: "" },
    { ok: st.building || st.parcel, label: isLand ? "토지 정보" : "건물 정보", ready: isLand ? "지목·용도지역·도로 접면" : "준공·용도·세대수", later: "건축물대장·토지특성을 다음 수집 때 받습니다" },
    { ok: st.officialPrice, label: isLand ? "개별공시지가" : "공시가격", ready: "연도별 이력", later: "공시가격을 다음 수집 때 받습니다" },
    { ok: st.location, label: "입지 점수", ready: "교통·학교·생활편의", later: "주변 시설을 모아 점수를 계산합니다", href: "?tab=location" },
    { ok: st.valuation, label: "추정 시세", ready: "구간·신뢰도", later: "거래가 모이면 계산합니다" },
    { ok: st.news > 0, label: "관련 뉴스", ready: `${st.news}건`, later: "키워드로 매일 모읍니다", href: "?tab=news" },
  ];
  const pending = rows.filter((r) => !r.ok);
  // 등록 직후가 아니면 핵심(실거래·추정 시세)이 비어 있을 때만 보인다
  if (!welcome && !pending.some((r) => r.label === "실거래" || r.label === "추정 시세")) return null;
  return (
    <Card className="mb-4">
      <CardHeader
        title={welcome ? "등록했습니다" : "아직 채워지지 않은 정보"}
        sub={pending.length ? "빈 항목은 매일 아침(06시 전후) 자동 수집 후 채워집니다. 알림으로 알려 드립니다." : "필요한 정보가 모두 준비됐습니다."}
      />
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 pb-4 text-sm sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2">
            {r.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" /> : <Clock size={16} className="mt-0.5 shrink-0 text-muted" />}
            <span className="min-w-0">
              <span className="font-medium">{r.label}</span>{" "}
              <span className="text-muted">
                {r.ok ? r.ready : r.later}
                {r.ok && r.href ? (
                  <>
                    {" · "}
                    <Link href={r.href} className="text-accent">보기</Link>
                  </>
                ) : null}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
