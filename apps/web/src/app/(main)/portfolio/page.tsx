import type { Metadata } from "next";
import Link from "next/link";
import { LineSeriesChart } from "@/components/charts/series-chart";
import { Card, CardHeader, EmptyState, Notice, PageHeader, Stat } from "@/components/ui";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatDate, formatManwon, formatPct } from "@/lib/format";
import { holdingTax } from "@/lib/tax";

export const metadata: Metadata = { title: "포트폴리오" };

type Row = {
  id: string;
  label: string;
  property_type: string;
  pnu: string | null;
  purchase_price: number | null;
  purchase_date: string | null;
  loans: { name?: string; amount: number; rate: number; maturity?: string }[];
  lease: { deposit: number; rent?: number; role?: string; end_date?: string } | null;
  estimate: number | null;
  official: number | null; // 원
};

export default async function PortfolioPage(props: PageProps<"/portfolio">) {
  const [uid, sp] = await Promise.all([sessionUserId(), props.searchParams]);
  // 보유 물건 목록과 월별 합계를 동시에 조회(합계는 같은 조건의 하위 쿼리로 물건을 고른다)
  const [, rows, history] = await Promise.all([
    requireUser(),
    sql<Row[]>`
      select w.id, w.label, w.property_type, w.pnu, w.purchase_price, w.purchase_date::text, w.loans, w.lease,
        (select estimate from valuations v where v.watch_item_id = w.id order by as_of desc limit 1) as estimate,
        (select o.price from official_prices o where o.target_type in ('apt_unit', 'house')
           and (o.target_key = w.pnu or o.target_key like w.pnu || '|%') order by o.year desc limit 1) as official
      from watch_items w where w.user_id = ${uid} and w.group_tag = 'owned' order by w.created_at`,
    sql<{ month: string; value: number }[]>`
      with owned as (select id from watch_items where user_id = ${uid} and group_tag = 'owned')
      select to_char(date_trunc('month', v.as_of), 'YYYY-MM-01') as month, sum(v.estimate)::float8 as value
      from (select distinct on (watch_item_id, date_trunc('month', as_of)) watch_item_id, as_of, estimate from valuations
            where watch_item_id in (select id from owned) order by watch_item_id, date_trunc('month', as_of), as_of desc) v
      group by 1 having count(*) = (select count(*) from owned) order by 1`,
  ]);

  if (!rows.length) {
    return (
      <div>
        <PageHeader title="포트폴리오" />
        <Card><EmptyState title="보유 물건이 없습니다" desc="물건을 등록할 때 그룹을 ‘보유’로 지정하면 자산·대출·보유세를 모아 보여줍니다." /></Card>
      </div>
    );
  }

  const value = rows.reduce((a, r) => a + (r.estimate ?? r.purchase_price ?? 0), 0);
  const cost = rows.reduce((a, r) => a + (r.purchase_price ?? 0), 0);
  const loans = rows.flatMap((r) => r.loans.map((l) => ({ ...l, item: r.label })));
  const debt = loans.reduce((a, l) => a + (l.amount || 0), 0);
  const interest = loans.reduce((a, l) => a + (l.amount || 0) * ((l.rate || 0) / 100), 0);
  const deposits = rows.reduce((a, r) => a + (r.lease && r.lease.role !== "tenant" ? r.lease.deposit : 0), 0);
  const rentIncome = rows.reduce((a, r) => a + (r.lease && r.lease.role !== "tenant" ? (r.lease.rent ?? 0) * 12 : 0), 0);
  const equity = value - debt - deposits;

  const houses = rows.filter((r) => ["apt", "officetel", "rowhouse", "house"].includes(r.property_type));
  const oneHouse = sp.one ? sp.one === "1" : houses.length === 1;
  const officials = houses.map((r) => (r.official ? r.official / 10000 : null));
  const known = officials.filter((x): x is number => x !== null);
  const tax = known.length ? holdingTax(known, oneHouse) : null;

  return (
    <div className="space-y-4">
      <PageHeader title="포트폴리오" sub="보유 물건의 추정 시세·대출·임대·보유세(개략)" />
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="보유 자산(추정)" value={formatManwon(value, { short: true })} sub={<span className="text-muted">{rows.length}건</span>} />
          <Stat label="평가 손익" value={cost ? formatManwon(value - cost, { short: true }) : "-"} sub={cost ? <span className={value >= cost ? "text-up" : "text-down"}>{formatPct(value / cost - 1)}</span> : null} />
          <Stat label="순자산" value={formatManwon(equity, { short: true })} sub={<span className="text-muted">대출 {formatManwon(debt, { short: true })} · 보증금 {formatManwon(deposits, { short: true })}</span>} />
          <Stat label="LTV / 연 이자" value={`${value ? formatPct(debt / value, 1, false) : "-"}`} sub={<span className="text-muted">이자 약 {formatManwon(interest, { short: true })}/년{rentIncome ? ` · 월세 수입 ${formatManwon(rentIncome, { short: true })}/년` : ""}</span>} />
        </div>
      </Card>

      {history.length >= 2 ? (
        <Card>
          <CardHeader title="보유 자산 추정가 추이" sub="월별 AVM 합계" />
          <div className="px-2 pb-3">
            <LineSeriesChart lines={[{ name: "보유 자산", points: history.map((h) => [h.month, h.value] as [string, number]) }]} fmt="manwon" height={200} />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="보유 물건" />
        <div className="overflow-x-auto pb-2">
          <table className="w-full min-w-[640px] whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">물건</th>
                <th className="px-2 py-2 text-right font-medium">추정가</th>
                <th className="px-2 py-2 text-right font-medium">매입가</th>
                <th className="px-2 py-2 text-right font-medium">손익</th>
                <th className="px-2 py-2 text-right font-medium">대출</th>
                <th className="px-2 py-2 text-right font-medium">공시가격</th>
                <th className="px-4 py-2 text-right font-medium">비중</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((r) => {
                const v = r.estimate ?? r.purchase_price ?? 0;
                return (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2"><Link href={`/items/${r.id}`} className="hover:text-accent">{r.label}</Link></td>
                    <td className="px-2 py-2 text-right">{formatManwon(r.estimate, { short: true })}</td>
                    <td className="px-2 py-2 text-right">{formatManwon(r.purchase_price, { short: true })}</td>
                    <td className={`px-2 py-2 text-right ${r.purchase_price && v >= r.purchase_price ? "text-up" : "text-down"}`}>{r.purchase_price ? formatPct(v / r.purchase_price - 1) : "-"}</td>
                    <td className="px-2 py-2 text-right">{formatManwon(r.loans.reduce((a, l) => a + (l.amount || 0), 0) || null, { short: true })}</td>
                    <td className="px-2 py-2 text-right">{r.official ? formatManwon(r.official / 10000, { short: true }) : "-"}</td>
                    <td className="px-4 py-2 text-right">{value ? formatPct(v / value, 0, false) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="보유세 개략 추정(연)"
          sub="주택분 재산세(도시지역분·지방교육세 포함) + 종합부동산세(농특세 포함)"
          action={
            <Link href={`/portfolio?one=${oneHouse ? 0 : 1}`} className="text-accent">
              {oneHouse ? "1세대1주택 기준 ✓" : "일반 기준 ✓"} (전환)
            </Link>
          }
        />
        <div className="space-y-3 px-4 pb-4 text-sm">
          {tax ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Stat label="재산세 계" value={formatManwon(tax.property)} />
                <Stat label="종부세 계" value={formatManwon(tax.comprehensive.total)} sub={<span className="text-muted">과세표준 {formatManwon(tax.comprehensive.base, { short: true })}</span>} />
                <Stat label="합계" value={formatManwon(tax.total)} />
              </div>
              {officials.some((o) => o === null) ? <p className="text-xs text-warn">공시가격이 없는 주택은 제외했습니다(ETL attrs 수집 필요).</p> : null}
            </>
          ) : (
            <p className="text-muted">보유 주택의 공시가격이 아직 없습니다(ETL attrs 단계에서 수집).</p>
          )}
          <Notice>
            참고용 개략치입니다. 종부세 세액공제(고령자·장기보유), 재산세 중복분 공제, 세부담 상한, 3주택 이상 중과세율, 토지분은 반영하지 않았고 세법·시행령은 매년 바뀝니다. 실제 세액은 고지서·세무 전문가로 확인하세요.
          </Notice>
        </div>
      </Card>

      {loans.length ? (
        <Card>
          <CardHeader title="대출" />
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {loans.map((l, i) => (
              <li key={i} className="flex justify-between gap-2 py-2">
                <span>{l.item} · {l.name ?? "대출"} <span className="text-xs text-muted">{l.rate}%{l.maturity ? ` · 만기 ${formatDate(l.maturity)}` : ""}</span></span>
                <span className="tabular shrink-0 whitespace-nowrap font-medium">{formatManwon(l.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
