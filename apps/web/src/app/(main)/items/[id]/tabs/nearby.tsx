import Link from "next/link";
import { RelativeBars } from "@/components/items/relative-bars";
import { TxTable } from "@/components/items/tx-table";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { formatManwon, formatPct } from "@/lib/format";
import { PROPERTY_TYPES } from "@/lib/property";
import { groupChange, regionChange, similarComplexes } from "@/lib/queries/comps";
import { nearbyTransactions, type WatchItem } from "@/lib/queries/items";

export async function NearbyTab({ item }: { item: WatchItem }) {
  if (item.lng === null) {
    return (
      <Card>
        <EmptyState title="좌표가 없어 주변 거래를 찾을 수 없습니다" desc="지오코딩 키(NCP)를 설정하거나 ETL 지오코딩 작업을 실행하세요." />
      </Card>
    );
  }
  const [rows, sim, sgg] = await Promise.all([
    nearbyTransactions(item, { months: 6 }),
    similarComplexes(item),
    item.sgg_cd ? regionChange(item.sgg_cd, PROPERTY_TYPES[item.property_type].tx, item.area_m2) : Promise.resolve(null),
  ]);
  const compChange = groupChange(sim.comps);

  return (
    <div className="space-y-4">
      {sim.self ? (
        <Card>
          <CardHeader title="상대 성과" sub="평당가 중위 변화 · 최근 6개월 vs 1년 전(12~18개월) · 같은 면적대" />
          <div className="px-4 pb-4">
            <RelativeBars
              rows={[
                { label: "내 단지", value: sim.self.change, emphasis: true },
                { label: `유사 단지 ${sim.comps.length}곳`, value: compChange },
                { label: "시군구 전체", value: sgg },
              ]}
            />
            {sim.self.change !== null && compChange !== null ? (
              <p className="mt-3 text-xs text-muted">
                {Math.abs(sim.self.change - compChange) < 0.005
                  ? "유사 단지와 비슷한 흐름입니다."
                  : `유사 단지 대비 ${sim.self.change - compChange > 0 ? "초과" : "부진"} ${formatPct(Math.abs(sim.self.change - compChange), 1, false)}p`}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {sim.comps.length ? (
        <Card>
          <CardHeader title="유사 단지" sub="거리·연식·세대수·평당가가 비슷한 순 (유사도 0~100)" />
          <div className="overflow-x-auto pb-2">
            <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">단지</th>
                  <th className="px-2 py-2 text-right font-medium">유사도</th>
                  <th className="px-2 py-2 text-right font-medium">거리</th>
                  <th className="px-2 py-2 text-right font-medium">준공</th>
                  <th className="px-2 py-2 text-right font-medium">평당가(6M)</th>
                  <th className="px-2 py-2 text-right font-medium">1년 변화</th>
                  <th className="px-4 py-2 text-right font-medium">최근 거래</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {sim.self ? <CompRow c={sim.self} self /> : null}
                {sim.comps.map((c) => (
                  <CompRow key={c.id} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="반경 내 최근 매매"
          sub={`반경 ${item.radius_m.toLocaleString()}m · 최근 6개월 · ${rows.length}건`}
          action={<Link href={`/map?item=${item.id}`} className="text-accent">지도로 보기</Link>}
        />
        <TxTable rows={rows} showName extra="dist" />
      </Card>
    </div>
  );
}

function CompRow({ c, self = false }: { c: { id: number; name: string; score: number; dist_m: number; build_year: number | null; ppy_recent: number | null; change: number | null; last_price: number | null }; self?: boolean }) {
  return (
    <tr className={`border-b border-border/60 last:border-0 ${self ? "bg-accent-soft/50 font-medium" : ""}`}>
      <td className="max-w-[180px] truncate px-4 py-2">{self ? `★ ${c.name}` : c.name}</td>
      <td className="px-2 py-2 text-right">{self ? "-" : Math.round(c.score * 100)}</td>
      <td className="px-2 py-2 text-right">{self ? "-" : `${(c.dist_m / 1000).toFixed(1)}km`}</td>
      <td className="px-2 py-2 text-right">{c.build_year ?? "-"}</td>
      <td className="px-2 py-2 text-right">{formatManwon(c.ppy_recent, { short: true })}</td>
      <td className={`px-2 py-2 text-right ${c.change === null ? "text-muted" : c.change >= 0 ? "text-up" : "text-down"}`}>
        {c.change === null ? "-" : `${c.change >= 0 ? "▲" : "▼"}${formatPct(Math.abs(c.change), 1, false)}`}
      </td>
      <td className="px-4 py-2 text-right">{formatManwon(c.last_price, { short: true })}</td>
    </tr>
  );
}
