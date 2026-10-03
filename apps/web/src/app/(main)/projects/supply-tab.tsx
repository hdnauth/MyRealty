import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { shortSido } from "@/lib/projects";
import { supplyPipeline } from "@/lib/queries/projects";

/**
 * 공급 파이프라인: 시군구마다 앞으로 나올 물량.
 * - 2~4년: 관리처분인가~착공 정비사업의 공급 예정 세대수
 * - 4~8년: 조합설립~사업시행인가 정비사업
 * - 36개월 입주 예정(청약홈 분양 단지)
 */
export async function SupplyTab({ uid }: { uid: string }) {
  const rows = await supplyPipeline(uid);
  const max = Math.max(1, ...rows.map((r) => r.near_term + r.move_in));
  return (
    <Card>
      <CardHeader title="시군구별 공급 파이프라인" sub="내 관심 부동산 지역 먼저 · 단위 세대" />
      {rows.length ? (
        <div className="overflow-x-auto px-4 pb-3">
          <table className="w-full min-w-[640px] whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 font-medium">시군구</th>
                <th className="py-2 text-right font-medium">입주 예정 36개월</th>
                <th className="py-2 text-right font-medium">정비 2~4년(관리처분~착공)</th>
                <th className="py-2 text-right font-medium">정비 4~8년(조합~사업시행)</th>
                <th className="w-40 py-2 pl-3 font-medium">가까운 물량</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const near = r.near_term + r.move_in;
                return (
                  <tr key={r.sgg_cd} className="border-b border-border/60 last:border-0">
                    <td className="py-2">
                      <span className={r.mine ? "font-semibold" : ""}>{r.name.replace(/^(\S+)\s/, (_, sido: string) => `${shortSido(sido)} `)}</span>
                      {r.mine ? <span className="ml-1 text-[11px] text-accent">내 지역</span> : null}
                    </td>
                    <td className="tabular py-2 text-right">{r.move_in ? r.move_in.toLocaleString() : "-"} <span className="text-[11px] text-muted">{r.move_in_n ? `(${r.move_in_n}단지)` : ""}</span></td>
                    <td className="tabular py-2 text-right">{r.near_term ? r.near_term.toLocaleString() : "-"} <span className="text-[11px] text-muted">{r.near_term_zones ? `(${r.near_term_zones}구역)` : ""}</span></td>
                    <td className="tabular py-2 text-right">{r.mid_term ? r.mid_term.toLocaleString() : "-"} <span className="text-[11px] text-muted">{r.mid_term_zones ? `(${r.mid_term_zones}구역)` : ""}</span></td>
                    <td className="py-2 pl-3" title={`입주 예정 + 정비 2~4년: ${near.toLocaleString()}세대`}>
                      <span className="block h-2.5 rounded-r bg-surface-2">
                        <span className="block h-2.5 rounded-r bg-accent" style={{ width: `${Math.max(near ? 2 : 0, (near / max) * 100)}%` }} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="공급 자료가 없습니다" desc="정비구역(세대수)과 청약홈 입주 예정이 수집되면 채워집니다." />
      )}
      <p className="px-4 pb-4 text-[11px] leading-relaxed text-muted">
        정비사업 세대수는 국토교통부 전국 도시정비사업 통합 데이터·시군구 자료의 공급 예정 세대수입니다. 세대수가 없는 구역은 물량에 빠지므로
        구역 수를 함께 보세요. 입주 예정은 청약홈 분양 단지 기준. 자세한 구역은 <Link href="/projects?phase=building" className="text-accent">정비사업 → 이주·착공</Link>.
      </p>
    </Card>
  );
}
