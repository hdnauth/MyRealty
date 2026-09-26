import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, Stat } from "@/components/ui";
import { formatDate, formatPct } from "@/lib/format";
import type { WatchItem } from "@/lib/queries/items";
import { itemLocation, type LocDetail } from "@/lib/queries/location";

const CAT_LABEL: Record<string, string> = {
  subway: "지하철역", bus: "버스정류장", school: "학교", academy: "학원", hospital: "종합병원", clinic: "의원",
  mart: "대형마트·백화점", convenience: "편의점", food: "음식점", cafe: "카페", park: "공원",
};
const ZONE_STAGES = ["기본계획", "정비구역지정", "추진위", "조합설립", "사업시행인가", "관리처분인가", "이주·철거", "착공", "준공"];

const ORDER = ["transit", "school", "shopping", "park", "academy", "medical", "food"];

function detailText(d: LocDetail) {
  const what =
    d.cats.includes("hospital") ? "종합병원" : d.type !== "area" && d.subs?.length ? d.subs.join("·") : d.cats.map((c) => CAT_LABEL[c] ?? c).join("·");
  if (d.type === "near") return d.name ? `가장 가까운 ${what}: ${d.name} ${d.dist_m?.toLocaleString()}m` : `${what} 5km 내 없음`;
  if (d.type === "count") return `${d.radius.toLocaleString()}m 내 ${what} ${d.count}곳`;
  return `${d.radius.toLocaleString()}m 내 공원 면적 ${(d.area_m2 / 10000).toFixed(1)}ha`;
}

export async function LocationTab({ item }: { item: WatchItem }) {
  const loc = await itemLocation(item.id, item.sgg_cd);
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
          <p className="mt-1 text-sm">같은 시군구 아파트 중 상위 <b>{formatPct(1 - loc.percentile, 0, false)}</b></p>
        ) : null}
        <p className="mt-3 text-[11px] text-muted">
          교통 25 · 학교 15 · 쇼핑 15 · 공원 15 · 학원 10 · 의료 10 · 음식 10 가중. 거리는 직선거리 기준, 미수집 항목은 제외. 계산 {formatDate(loc.computed_at)}
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
              value={dev.far ? `${dev.far.headroom > 0 ? "+" : ""}${dev.far.headroom}%p` : "-"}
              sub={dev.far ? <span className="text-muted">현재 {dev.far.current}% / 상한 {dev.far.cap}%</span> : <span className="text-muted">건축물대장·용도지역 필요</span>}
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
