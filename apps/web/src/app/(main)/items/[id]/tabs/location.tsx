import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, Stat } from "@/components/ui";
import { formatDate, formatPct } from "@/lib/format";
import type { WatchItem } from "@/lib/queries/items";
import { itemLocation, type LocationCalibration, type LocCategory, locationCalibration, type LocDetail, openingEffects } from "@/lib/queries/location";

const CAT_LABEL: Record<string, string> = {
  subway: "지하철역", bus: "버스정류장", school: "학교", academy: "학원", hospital: "종합병원", clinic: "의원",
  mart: "대형마트·백화점", convenience: "편의점", food: "음식점", cafe: "카페", park: "공원",
};
const ZONE_STAGES = ["기본계획", "정비구역지정", "추진위", "조합설립", "사업시행인가", "관리처분인가", "이주·철거", "착공", "준공"];

export const ORDER = ["transit", "jobs", "school", "shopping", "park", "academy", "medical", "food"];

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m.toLocaleString()}m`);

export function detailText(d: LocDetail) {
  if (d.type === "jobs") {
    const core = d.core && d.core.name !== d.name ? ` · 도심 ${d.core.name} ${km(d.core.dist_m)}` : "";
    return `가장 가까운 업무지구: ${d.name} ${km(d.dist_m)}${core}`;
  }
  if (d.type === "lines") {
    if (!d.name) return `${km(d.walk)} 안 역 없음`;
    const lines = d.lines?.length ? d.lines.join("·") : `${d.n_lines ?? 1}개 노선${d.guess ? "(추정)" : ""}`;
    return `${d.name}역 ${lines}${(d.n_lines ?? 1) >= 2 ? " 환승" : ""}`;
  }
  const what =
    "label" in d && d.label
      ? d.label
      : d.cats.includes("hospital")
        ? "종합병원"
        : d.type !== "area" && d.subs?.length
          ? d.subs.join("·")
          : d.cats.map((c) => CAT_LABEL[c] ?? c).join("·");
  if (d.type === "near") {
    if (!d.name) return `${what} 5km 내 없음`;
    // 공원 등 영역이 있는 시설은 경계까지 거리와 규모(가장 가까운 곳이 아니라 거리·규모로 본 가장 좋은 곳)
    if (d.area_m2) return `${what}: ${d.name}(${(d.area_m2 / 10000).toFixed(1)}ha) 경계까지 ${d.dist_m?.toLocaleString()}m`;
    return `가장 가까운 ${what}: ${d.name} ${d.dist_m?.toLocaleString()}m`;
  }
  if (d.type === "count") return `${d.radius.toLocaleString()}m 내 ${what} ${d.count}곳`;
  return `${d.radius.toLocaleString()}m 내 공원 면적 ${(d.area_m2 / 10000).toFixed(1)}ha`;
}

/** 항목별 가중(저장된 점수의 weight, 미수집 제외)을 "교통 20 · 직주근접 20 …" 로 */
export function weightText(scores: Record<string, LocCategory>) {
  return ORDER.filter((k) => scores[k]?.weight)
    .map((k) => `${scores[k].label} ${Math.round((scores[k].weight ?? 0) * 100)}`)
    .join(" · ");
}

export async function LocationTab({ item }: { item: WatchItem }) {
  const [loc, effects, calib] = await Promise.all([itemLocation(item.id), openingEffects(item), locationCalibration()]);
  if (!loc) {
    return (
      <Card>
        <EmptyState
          title="아직 입지 점수가 없습니다"
          desc="ETL pois 단계가 주변 편의시설(상가정보·병원정보 API, 표준데이터 CSV)을 모은 뒤 점수를 계산합니다."
        />
      </Card>
    );
  }
  const dev = loc.development;
  const cats = Object.entries(loc.scores).sort(([a], [b]) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-4">
        <div className="text-xs text-muted">생활편의 점수</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-4xl font-bold">{loc.total !== null ? Math.round(loc.total) : "-"}</span>
          <span className="text-sm text-muted">/ 100</span>
        </div>
        {loc.percentile !== null ? (
          <p className="mt-1 text-sm">
            반경 1km 단지 {loc.peers}곳 중 상위 <b>{formatPct(Math.max(0.01, 1 - loc.percentile), 0, false)}</b>
          </p>
        ) : null}
        {loc.myRank !== null ? (
          <p className="mt-0.5 text-sm">
            내 관심 부동산 {loc.myCount}곳 중 <b>{loc.myRank}위</b>
          </p>
        ) : null}
        <p className="mt-3 text-[11px] text-muted">
          {weightText(loc.scores)} 가중. 개수 항목은 거리 가중 후 포화 곡선(수도권 주거지 보통 수준 ≈ 63점)이라 도심 상권·학원가와 한적한 곳이
          구별됩니다. 거리는 직선거리(공원은 경계까지, 규모 반영), 미수집 항목은 제외. 계산 {formatDate(loc.computed_at)}
        </p>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="항목별 점수" />
        <ul className="space-y-3 px-4 pb-4">
          {cats.map(([key, c]) => (
            <li key={key}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{c.label}</span>
                <span className="tabular">{c.score !== null ? Math.round(c.score) : <span className="text-xs text-muted">{c.status}</span>}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-surface-2">
                {c.score !== null ? <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max(2, c.score)}%` }} /> : null}
              </div>
              {c.details?.length ? (
                <p className="mt-1 text-xs text-muted">{c.details.map(detailText).join(" · ")}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {calib ? <CalibrationCard calib={calib} scores={loc.scores} /> : null}

      {dev ? (
        <Card className="lg:col-span-3">
          <CardHeader title="개발 요인" sub="정비사업(반경 1.5km) · 철도·도로 사업(반경 3km)" action={<Link href="/projects" className="text-accent">사업 등록</Link>} />
          <div className="grid grid-cols-2 gap-4 px-4 pb-2 sm:grid-cols-4">
            <Stat label="주변 정비구역" value={`${dev.zones_count}곳`} sub={<span className="text-muted">사업시행인가 이후 {dev.zones_advanced}곳</span>} />
            <Stat
              label="가장 가까운 신설역"
              value={dev.nearest_planned_station ? `${(dev.nearest_planned_station.dist_m / 1000).toFixed(1)}km` : "-"}
              sub={dev.nearest_planned_station ? <span className="text-muted">{dev.nearest_planned_station.name} · {dev.nearest_planned_station.status}</span> : null}
            />
            <Stat
              label="재건축 연한(30년)"
              value={dev.rebuild ? (dev.rebuild.eligible ? "도달" : `${dev.rebuild.years_left}년 남음`) : "-"}
              sub={dev.rebuild ? <span className="text-muted">준공 {dev.rebuild.age}년차</span> : null}
            />
            <Stat
              label="용적률 여유"
              value={dev.far ? `${dev.far.headroom > 0 ? "+" : ""}${Math.round(dev.far.headroom)}%p` : "-"}
              sub={dev.far ? <span className="text-muted">현재 {Math.round(dev.far.current)}% / 상한 {dev.far.cap}%(서울 조례 기준 참고)</span> : <span className="text-muted">건축물대장·용도지역 필요</span>}
            />
          </div>
          {dev.zones.length ? (
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-2 font-medium">구역</th>
                    <th className="py-2 font-medium">유형</th>
                    <th className="py-2 font-medium">단계</th>
                    <th className="py-2 text-right font-medium">계획 세대</th>
                    <th className="py-2 text-right font-medium">거리</th>
                  </tr>
                </thead>
                <tbody>
                  {dev.zones.map((z) => (
                    <tr key={z.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2">{z.name}</td>
                      <td className="py-2"><Badge>{z.kind}</Badge></td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-0.5" aria-label={`${z.stage_order ?? 0}/9 단계`}>
                            {ZONE_STAGES.map((s, i) => (
                              <span key={s} title={s} className={`h-2 w-2 rounded-sm ${i < (z.stage_order ?? 0) ? "bg-accent" : "bg-surface-2"}`} />
                            ))}
                          </div>
                          <span>{z.stage ?? "-"}</span>
                          {z.stage_date ? <span className="text-xs text-muted">{formatDate(z.stage_date)}</span> : null}
                        </div>
                      </td>
                      <td className="tabular py-2 text-right">{z.households_plan?.toLocaleString() ?? "-"}</td>
                      <td className="tabular py-2 text-right">{(z.dist_m / 1000).toFixed(1)}km</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {effects.length ? (
            <div className="px-4 pb-4">
              <div className="mb-1 text-sm font-semibold">개통 전후 1년 가격 변화</div>
              <ul className="space-y-1 text-sm">
                {effects.map((e) => (
                  <li key={e.name} className="flex flex-wrap justify-between gap-2">
                    <span>{e.name} <span className="text-xs text-muted">개통 {e.opened.slice(0, 7)} · {(e.dist_m / 1000).toFixed(1)}km</span></span>
                    <span className="tabular text-xs">
                      단지 {formatPct(e.complex)} · 시군구 {formatPct(e.region)}
                      {e.excess !== null ? <b className={e.excess >= 0 ? "ml-1 text-up" : "ml-1 text-down"}>초과 {formatPct(e.excess)}p</b> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted">단순 전후 비교로 다른 요인(금리·공급)이 섞여 있을 수 있습니다.</p>
            </div>
          ) : null}
          {dev.infra.length ? (
            <ul className="divide-y divide-border px-4 pb-4 text-sm">
              {dev.infra.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate">
                    <Badge tone={p.status === "개통" ? "neutral" : "accent"}>{p.status}</Badge> {p.name}
                    {p.line_name ? <span className="text-xs text-muted"> · {p.line_name}</span> : null}
                  </span>
                  <span className="tabular shrink-0 text-xs text-muted">
                    {p.expected_open ? `개통 ${p.expected_open.slice(0, 7)} · ` : ""}
                    {(p.dist_m / 1000).toFixed(1)}km
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

/** 점수 검증: 같은 시군구 단지끼리 평당가 차이를 점수가 얼마나 설명하는지, 항목별 가격 효과와 데이터가 가리키는 가중치 */
function CalibrationCard({ calib, scores }: { calib: LocationCalibration; scores: Record<string, LocCategory> }) {
  const spread = calib.spread?.total;
  const effects = calib.effects ? ORDER.filter((k) => calib.effects![k]).map((k) => [k, calib.effects![k]] as const) : [];
  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="점수 검증"
        sub={`같은 시군구 단지끼리 최근 2년 ㎡당 가격(지수로 시점 보정)과 비교 · ${formatDate(calib.computed_at)}`}
      />
      <div className="grid grid-cols-2 gap-4 px-4 pb-3 sm:grid-cols-4">
        <Stat
          label="점수 분포(p10~p90)"
          value={spread ? `${Math.round(spread.p10)}~${Math.round(spread.p90)}` : "-"}
          sub={spread ? <span className="text-muted">중위 {Math.round(spread.p50)} · 표준편차 {spread.std.toFixed(1)} · {spread.n}곳</span> : null}
        />
        {calib.status === "ok" ? (
          <>
            <Stat
              label="가격 설명력(R²)"
              value={`${Math.round((calib.r2_categories ?? 0) * 100)}%`}
              sub={<span className="text-muted">총점만 {Math.round((calib.r2_total ?? 0) * 100)}% · 연식만 {Math.round((calib.r2_age_only ?? 0) * 100)}%</span>}
            />
            <Stat
              label="총점 +10점"
              value={`${(calib.total_per10_pct ?? 0) >= 0 ? "+" : ""}${(calib.total_per10_pct ?? 0).toFixed(1)}%`}
              sub={<span className="text-muted">같은 시군구·같은 연식 기준 ㎡당 가격</span>}
            />
            <Stat label="비교 단지" value={`${calib.n}곳`} sub={<span className="text-muted">{calib.sggs}개 시군구</span>} />
          </>
        ) : (
          <p className="col-span-1 self-center text-sm text-muted sm:col-span-3">
            최근 2년 매매가 있는 점수 계산 단지가 {calib.complexes_with_price}곳이라 가격과 비교하기엔 부족합니다({calib.min_complexes}곳 이상 필요). 관심 부동산이 늘면 자동으로 계산됩니다.
          </p>
        )}
      </div>
      {effects.length ? (
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full min-w-[480px] whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 font-medium">항목</th>
                <th className="py-2 text-right font-medium">+10점 가격 효과</th>
                <th className="py-2 text-right font-medium">현재 가중</th>
                <th className="py-2 text-right font-medium">데이터 권장</th>
              </tr>
            </thead>
            <tbody>
              {effects.map(([k, e]) => (
                <tr key={k} className="border-b border-border/60 last:border-0">
                  <td className="py-2">{scores[k]?.label ?? e.label}</td>
                  <td className={`tabular py-2 text-right ${e.per10_pct >= 0 ? "text-up" : "text-down"}`}>
                    {e.per10_pct >= 0 ? "+" : ""}
                    {e.per10_pct.toFixed(1)}%
                  </td>
                  <td className="tabular py-2 text-right">{Math.round(e.weight_now * 100)}</td>
                  <td className="tabular py-2 text-right font-semibold">{Math.round(e.weight_suggest * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-muted">
            데이터 권장 가중은 회귀 결과를 표본 수만큼만 반영(적으면 현재 가중 쪽)한 참고값이며 자동으로 바꾸지 않습니다. 가격에는 학군 평판·브랜드·향 등 점수에 없는 요인도 섞여 있습니다.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
