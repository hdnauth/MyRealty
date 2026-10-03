import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import type { AreaUnit } from "@/lib/format";
import { formatManwon, fromPerPyeong, unitPriceLabel } from "@/lib/format";
import { shortSido } from "@/lib/projects";
import { FAR_BASIS_LABEL, type FarBasis, farCap } from "@/lib/far";
import { type RebuildCandidate, rebuildCandidates } from "@/lib/queries/projects";
import { Chip } from "./zone-parts";

const PY = 3.305785;
/** '전남광주통합특별시 순천시' → '전남광주 순천시' */
const sggLabel = (name: string | null, code: string) => (name ? name.replace(/^(\S+)\s/, (_, sido: string) => `${shortSido(sido)} `) : code);
const AGES = [25, 30, 35] as const;
const SORTS = { score: "종합", headroom: "용적률 여유", share: "대지지분", age: "연식", price: "평당가 낮은" } as const;
export type RebuildSort = keyof typeof SORTS;

type Scored = RebuildCandidate & { cap: number | null; basis: FarBasis | null; zoneName: string | null; headroom: number | null; share: number | null; age: number; score: number };

/**
 * 재건축 후보: 아직 사업 초기이거나 구역 지정 전인 준공 오래된 아파트 단지.
 * 사업성 재료 — 용적률 여유(용도지역 상한 − 현재), 세대당 대지지분, 연식 — 를 한 표로. 점수는 세 재료의 단순 합(참고).
 */
export async function RebuildTab({ uid, sgg, age, sort, unit, href }: {
  uid: string;
  sgg: string | null;
  age: number;
  sort: RebuildSort;
  unit: AreaUnit;
  href: (patch: Record<string, string | null>) => string;
}) {
  const { rows, sggs } = await rebuildCandidates(uid, { sgg, minAge: age });
  const year = new Date().getFullYear();
  const scored: Scored[] = rows.map((r) => {
    const fc = farCap(r.zones, r.sgg_cd);
    const zoneName = fc?.zone ?? null;
    const cap = fc?.cap ?? null;
    const headroom = cap !== null && r.vl_rat ? cap - r.vl_rat : null;
    const share = r.plat_area && r.households ? r.plat_area / r.households / PY : null;
    const a = year - r.build_year;
    // 여유 100%p·지분 15평·연식 40년을 각각 만점 1로 본 단순 합(없는 재료는 0)
    const score = Math.min(1, Math.max(0, (headroom ?? 0) / 100)) + Math.min(1, (share ?? 0) / 15) + Math.min(1, a / 40);
    return { ...r, cap, basis: fc?.basis ?? null, zoneName, headroom, share, age: a, score };
  });
  const by: Record<RebuildSort, (a: Scored, b: Scored) => number> = {
    score: (a, b) => b.score - a.score,
    headroom: (a, b) => (b.headroom ?? -999) - (a.headroom ?? -999),
    share: (a, b) => (b.share ?? -1) - (a.share ?? -1),
    age: (a, b) => b.age - a.age,
    price: (a, b) => (a.ppy ?? Infinity) - (b.ppy ?? Infinity),
  };
  scored.sort(by[sort]);
  const withRegister = rows.filter((r) => r.vl_rat !== null).length;

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-2 p-4">
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {AGES.map((a) => <Chip key={a} href={href({ age: a === 30 ? null : String(a) })} active={age === a}>준공 {a}년+</Chip>)}
          </div>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
            <Chip href={href({ csgg: null })} active={!sgg}>모든 지역</Chip>
            {sggs.map((s) => <Chip key={s.sgg_cd} href={href({ csgg: s.sgg_cd })} active={sgg === s.sgg_cd}>{sggLabel(s.name, s.sgg_cd)} {s.n}</Chip>)}
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs">
            <span className="text-muted">정렬</span>
            {(Object.keys(SORTS) as RebuildSort[]).map((k) => (
              <Link key={k} href={href({ sort: k === "score" ? null : k })} scroll={false} className={sort === k ? "font-semibold text-accent" : "text-muted"}>{SORTS[k]}</Link>
            ))}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader
          title={`재건축 후보 ${rows.length}단지`}
          sub={`준공 ${age}년 이상 · 100세대 이상 아파트 · 건축물대장 확보 ${withRegister}곳(매일 채움)`}
        />
        {scored.length ? (
          <div className="overflow-x-auto px-4 pb-3">
            <table className="w-full min-w-[720px] whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 font-medium">단지</th>
                  <th className="py-2 text-right font-medium">준공</th>
                  <th className="py-2 text-right font-medium">세대</th>
                  <th className="py-2 text-right font-medium">용적률 (상한)</th>
                  <th className="py-2 text-right font-medium">여유</th>
                  <th className="py-2 text-right font-medium">세대당 대지</th>
                  <th className="py-2 text-right font-medium">{unitPriceLabel(unit)}</th>
                  <th className="py-2 pl-3 font-medium">정비사업</th>
                </tr>
              </thead>
              <tbody>
                {scored.slice(0, 200).map((r) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[14rem] py-2">
                      <Link href={`/complexes/${r.id}`} className="block truncate text-accent">{r.name}</Link>
                      <span className="text-[0.75rem] text-muted">{sggLabel(r.sgg_name, r.sgg_cd)}{r.mine ? " · " : ""}{r.mine ? <Link href={`/items/${r.mine}`} className="text-accent">내 부동산</Link> : null}</span>
                    </td>
                    <td className="tabular py-2 text-right">{r.build_year} <span className="text-[0.75rem] text-muted">({r.age}년)</span></td>
                    <td className="tabular py-2 text-right">{r.households?.toLocaleString() ?? "-"}</td>
                    <td className="tabular py-2 text-right">{r.vl_rat ? `${Math.round(r.vl_rat)}%` : "-"} <span className="text-[0.75rem] text-muted" title={r.basis ? FAR_BASIS_LABEL[r.basis] : undefined}>{r.cap ? `(${r.cap}%${r.basis === "law" ? "*" : ""})` : ""}</span></td>
                    <td className={`tabular py-2 text-right ${r.headroom !== null && r.headroom > 0 ? "font-semibold text-up" : ""}`}>
                      {r.headroom !== null ? `${r.headroom > 0 ? "+" : ""}${Math.round(r.headroom)}%p` : "-"}
                    </td>
                    <td className="tabular py-2 text-right">{r.share ? `${r.share.toFixed(1)}평` : "-"}</td>
                    <td className="tabular py-2 text-right">{r.ppy ? formatManwon(fromPerPyeong(r.ppy, unit), { short: true }) : "-"}</td>
                    <td className="py-2 pl-3">
                      {r.zone ? <Link href={`/projects?zone=${r.zone.id}`}><Badge tone="accent">{r.zone.stage ?? "구역"}</Badge></Link> : <span className="text-xs text-muted">구역 지정 전</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="후보 단지가 없습니다" desc="수집된 시군구(관심 부동산이 있는 지역)의 단지만 봅니다. 관심 부동산을 등록하면 그 지역 단지가 채워집니다." />
        )}
        <p className="px-4 pb-4 text-[0.75rem] leading-relaxed text-muted">
          용적률 상한은 서울은 서울시 도시계획 조례, 그 밖(*)은 국토계획법 시행령 상한(참고값)입니다 — 시·군 조례는 대개 더 낮아 여유가 실제보다 크게 보일 수 있습니다. 세대당 대지 = 대지면적 ÷ 세대수(평균). 실제 사업성은
          종상향·기부채납·분담금에 따라 크게 달라지므로 재료로만 쓰세요. 수집된 시군구 단지만 대상입니다.
        </p>
      </Card>
    </div>
  );
}
