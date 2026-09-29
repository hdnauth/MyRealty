import { Card, CardHeader, Stat } from "@/components/ui";
import { formatManwon, formatNumber, formatUnitPrice } from "@/lib/format";
import type { WatchItem } from "@/lib/queries/items";
import type { LandMarket } from "@/lib/queries/special";

const PY = 3.305785;
/** 만원/㎡ → "123,000원/㎡" */
function perM2Text(v: number | null) {
  if (!v) return "-";
  return `${formatUnitPrice(v)}/㎡`;
}

/**
 * 토지·임야 주변 시장: 지목·용도지역별 ㎡당 중위, 내 지목의 연도별 흐름, 내 필지 공시지가·크기 비교.
 * 토지는 같은 지목·용도지역·비슷한 크기끼리 비교해야 의미가 있다.
 */
export function LandMarketCard({ m, item }: { m: LandMarket; item: WatchItem }) {
  const jimok = m.parcel?.jimok ?? null;
  const mine = jimok ? m.byJimok.find((r) => r.jimok === jimok) ?? null : null;
  const official = m.parcel?.officialPerM2 ?? null; // 원/㎡
  const area = item.land_area_m2 ?? item.area_m2;
  const officialTotal = official && area ? (official * Number(area)) / 10000 : null; // 만원
  // 주변 거래 필지보다 내 필지가 얼마나 큰지. 큰 필지는 ㎡당 가격이 낮아(규모 할인) 소필지 ㎡당가를 그대로 곱하면 과대평가된다.
  // ('실거래 ÷ 공시지가' 배율은 거래 필지마다의 공시지가가 필요한데 실거래 지번이 가려져 있어 계산할 수 없다)
  const sizeRatio = area && mine?.area ? Number(area) / mine.area : null;
  const total = m.byJimok.reduce((n, r) => n + r.n, 0);
  return (
    <Card>
      <CardHeader
        title="주변 토지 시장"
        sub={`반경 ${(item.radius_m / 1000).toLocaleString()}km · 최근 3년 토지 매매 ${total}건 · 실거래 좌표는 읍면동 중심 기준`}
      />
      <div className="grid grid-cols-2 gap-4 px-4 pb-3 sm:grid-cols-4">
        <Stat label={`${jimok ?? "같은 지목"} ㎡당 중위`} value={perM2Text(mine?.perM2 ?? null)} sub={<span className="text-muted">{mine ? `${mine.n}건(1년 ${mine.n12m}건) · 평당 ${formatUnitPrice(mine.perM2! * PY)}` : "같은 지목 거래 없음"}</span>} />
        <Stat
          label="내 필지 공시지가"
          value={official ? `${formatNumber(official)}원/㎡` : "-"}
          sub={<span className="text-muted">{m.parcel?.officialYear ? `${m.parcel.officialYear}년` : "개별공시지가 미수집"}</span>}
        />
        <Stat
          label="공시지가 총액"
          value={formatManwon(officialTotal, { short: true })}
          sub={<span className="text-muted">{area ? `${formatNumber(Math.round(Number(area)))}㎡ × 공시지가` : "면적 필요"}</span>}
        />
        <Stat
          label="주변 거래 대비 크기"
          value={sizeRatio ? (sizeRatio >= 10 ? `${formatNumber(Math.round(sizeRatio))}배` : `${sizeRatio.toFixed(1)}배`) : "-"}
          sub={
            <span className={sizeRatio && (sizeRatio >= 5 || sizeRatio <= 0.2) ? "text-warn" : "text-muted"}>
              {sizeRatio && (sizeRatio >= 5 || sizeRatio <= 0.2)
                ? "크기 차이가 커 ㎡당 중위를 그대로 곱하면 안 됩니다"
                : mine?.area
                  ? `${jimok} 거래 중위 ${formatNumber(Math.round(mine.area))}㎡`
                  : "면적 필요"}
            </span>
          }
        />
      </div>
      {m.trend.length > 1 ? (
        <div className="border-t border-border px-4 py-2 text-sm">
          <span className="text-xs text-muted">{jimok} ㎡당 중위 연도별: </span>
          {m.trend.map((t, i) => (
            <span key={t.year} className="tabular">
              {i ? " → " : ""}
              {t.year} <b>{formatUnitPrice(t.perM2)}</b>
              <span className="text-xs text-muted">({t.n})</span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 border-t border-border px-4 py-3 text-sm sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-muted">지목별 ㎡당 중위</div>
          <ul className="space-y-0.5">
            {m.byJimok.map((r) => (
              <li key={r.jimok} className={`flex justify-between tabular ${r.jimok === jimok ? "font-semibold text-accent" : ""}`}>
                <span>
                  {r.jimok} <span className="text-xs text-muted">{r.n}건 · 중위 {r.area ? `${formatNumber(Math.round(r.area))}㎡` : "-"}</span>
                </span>
                <span>{perM2Text(r.perM2)}</span>
              </li>
            ))}
            {!m.byJimok.length ? <li className="text-muted">반경 안 토지 거래가 없습니다. 수정에서 반경을 넓혀 보세요.</li> : null}
          </ul>
        </div>
        {m.byZone.length ? (
          <div>
            <div className="mb-1 text-xs font-medium text-muted">용도지역별 ㎡당 중위{m.parcel?.zones.length ? ` · 내 필지 ${m.parcel.zones.join(", ")}` : ""}</div>
            <ul className="space-y-0.5">
              {m.byZone.map((r) => (
                <li key={r.zone} className={`flex justify-between tabular ${m.parcel?.zones.includes(r.zone) ? "font-semibold text-accent" : ""}`}>
                  <span>
                    {r.zone} <span className="text-xs text-muted">{r.n}건</span>
                  </span>
                  <span>{perM2Text(r.perM2)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="px-4 pb-4 text-[11px] text-muted">토지는 도로 접면·형상·경사에 따라 같은 지목이라도 가격 차이가 큽니다. 큰 필지일수록 ㎡당 가격이 낮은 편이라, 추정 시세(분석 탭)는 비슷한 크기(1/5~5배) 거래만으로 계산합니다.</p>
    </Card>
  );
}
