import Link from "next/link";
import { MapPin } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, LinkButton } from "@/components/ui";
import { shortSido } from "@/lib/projects";
import { myRegulations } from "@/lib/queries/projects";

/**
 * 규제: 토지거래허가구역(실거주 의무·허가 필요), 지구단위계획구역(건축 제한·인센티브), 정비구역.
 * 내 관심 부동산은 필지 토지이용계획과 구역 경계 두 가지로 판정하고, 지역별 허가구역 면적을 요약한다.
 */
export async function RegulationTab({ uid }: { uid: string }) {
  const { items, summary } = await myRegulations(uid);
  const permits = summary.filter((s) => s.kind === "permit");
  const plans = summary.filter((s) => s.kind === "district_plan");
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="내 관심 부동산"
          sub="필지 토지이용계획 + 구역 경계로 판정"
          action={<LinkButton href="/map?layers=permit,district_plan" variant="secondary" className="h-8 px-3 text-xs"><MapPin size={13} />지도로 보기</LinkButton>}
        />
        {items.length ? (
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {items.map((it) => (
              <li key={it.id} className="py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/items/${it.id}`} className="mr-1 min-w-0 max-w-[14rem] truncate font-medium">{it.label}</Link>
                  {it.permit ? <Badge tone="up">토지거래허가구역</Badge> : null}
                  {it.district_plan ? <Badge tone="accent">지구단위계획구역</Badge> : null}
                  {it.zone ? <Badge tone="ok">정비구역</Badge> : null}
                  {!it.permit && !it.district_plan && !it.zone ? <span className="text-xs text-muted">해당 없음</span> : null}
                </div>
                {it.uses.length ? <p className="mt-0.5 truncate text-[11px] text-muted">토지이용계획: {it.uses.join(" · ")}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="좌표가 있는 관심 부동산이 없습니다" />
        )}
        <p className="px-4 pb-4 text-[11px] leading-relaxed text-muted">
          토지거래허가구역에서는 일정 면적 이상 주택·토지를 살 때 시군구청 허가가 필요하고, 주택은 실거주(갭투자 제한) 조건이 붙습니다. 지정·해제는 수시로
          바뀌므로 계약 전 토지이음(eum.go.kr)에서 확인하세요.
        </p>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <RegionList title="토지거래허가구역" rows={permits} />
        <RegionList title="지구단위계획구역" rows={plans} />
      </div>
    </div>
  );
}

function RegionList({ title, rows }: { title: string; rows: { sido: string | null; sgg_name: string | null; n: number; area_km2: number; dyear: string | null }[] }) {
  return (
    <Card>
      <CardHeader title={title} sub="관심 부동산·정비구역 주변에서 받은 경계 기준(시군구별 면적)" />
      {rows.length ? (
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {rows.slice(0, 30).map((r, i) => (
            <li key={i} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">{shortSido(r.sido)} {r.sgg_name}</span>
              <span className="tabular shrink-0 text-xs">{r.area_km2.toLocaleString()}㎢</span>
              <span className="w-20 shrink-0 whitespace-nowrap text-right text-[11px] text-muted">{r.n}곳{r.dyear ? ` · ${r.dyear}` : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-4 text-xs text-muted">규제 구역 경계를 준비하고 있어요. 매일 아침 자동으로 수집됩니다.</p>
      )}
    </Card>
  );
}
