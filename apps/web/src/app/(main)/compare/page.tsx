import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui";
import { AiReportButton } from "@/components/ai/report-button";
import { AiSetupNotice } from "@/components/ai/setup-notice";
import { aiStatus } from "@/lib/ai/client";
import { latestCompare } from "@/lib/ai/compare";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { getAreaUnit } from "@/lib/area-unit";
import { formatArea, formatDate, formatManwon, formatNumber, formatPct, perUnitArea, unitPriceName } from "@/lib/format";
import { PROPERTY_TYPES } from "@/lib/property";
import { itemAttrs, itemTransactions, listItems, summarize } from "@/lib/queries/items";
import { getItem } from "@/lib/queries/items";
import { CompareButton } from "./compare-button";
import { LineSeriesChart } from "@/components/charts/series-chart";
import { monthlyRollingMedian, rebase } from "@/lib/item-analytics";
import { relativePosition, similarComplexes } from "@/lib/queries/comps";

export const metadata: Metadata = { title: "비교" };

export default async function ComparePage(props: PageProps<"/compare">) {
  const [uid, sp] = await Promise.all([sessionUserId(), props.searchParams]);
  const [, all, unit] = await Promise.all([requireUser(), listItems(uid), getAreaUnit()]);
  const ids = (typeof sp.ids === "string" ? sp.ids.split(",") : all.slice(0, 3).map((i) => i.id)).filter((id) => all.some((i) => i.id === id)).slice(0, 5);
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(0, 5);
    return `/compare?ids=${next.join(",")}`;
  };

  const rows = await Promise.all(
    ids.map(async (id) => {
      // 부동산별로 필요한 조회를 동시에(부동산 정보가 필요한 것만 한 단계 뒤)
      const [it, [v], [loc], [news]] = await Promise.all([
        getItem(uid, id).then((x) => x!),
        sql<{ estimate: number; low: number; high: number; confidence: string }[]>`
          select estimate, low, high, confidence from valuations where watch_item_id = ${id} order by as_of desc limit 1`,
        sql<{ total: number | null; scores: Record<string, { score: number | null }>; development: { zones_count?: number; rebuild?: { age: number; years_left: number }; nearest_planned_station?: { dist_m: number } | null } | null }[]>`
          select total, scores, development from location_scores where target_type = 'item' and target_id = ${id}`,
        sql<{ pos: number; neg: number }[]>`
          select count(*) filter (where impact > 0)::int as pos, count(*) filter (where impact < 0)::int as neg
          from article_links where watch_item_id = ${id} and status = 'classified' and relevance >= 0.7 and classified_at > now() - interval '60 days'`,
      ]);
      const [txs, region, pos, attrs] = await Promise.all([
        itemTransactions(it, 5),
        it.sgg_cd
          ? sql<{ code: string; value: number }[]>`
              select s.code, (select value from series_values v where v.code = s.code order by period desc limit 1) as value
              from series s where s.code in (${`ind.temp.${it.sgg_cd}`}, ${`ind.burden.${it.sgg_cd}`})`
          : [],
        it.complex_id ? similarComplexes(it).then((sim) => relativePosition(it, sim.comps)) : Promise.resolve(null),
        itemAttrs(it),
      ]);
      const s = summarize(txs, new Date(), { perArea: !it.complex_id });
      // 단위면적당 가격 추이(3개월 이동 중위) — 크기가 다른 부동산도 같은 축에서 비교
      const trend = monthlyRollingMedian(
        txs
          .filter((t) => t.deal_kind === "sale" && !t.is_canceled && t.price && (t.area_m2 ?? t.land_area_m2))
          .map((t) => ({ date: t.deal_date, value: perUnitArea(t.price, Number(t.area_m2 ?? t.land_area_m2), unit)! })),
        { minN: it.complex_id ? 1 : 3 },
      );
      const area = it.area_m2 ?? it.land_area_m2;
      return {
        it,
        s,
        v,
        loc,
        temp: region.find((r) => r.code.startsWith("ind.temp"))?.value ?? null,
        burden: region.find((r) => r.code.startsWith("ind.burden"))?.value ?? null,
        news,
        ppy: v && area ? perUnitArea(v.estimate, area, unit) : null,
        trend,
        rel: pos?.rel ?? null,
        attrs,
        tradeCount: txs.filter((t) => t.deal_kind === "sale" && !t.is_canceled).length,
      };
    }),
  );
  const ai = ids.length >= 2 ? await latestCompare(uid, ids) : null;
  // 추이 차트: 6개월 이상 이어진 것만. 절대 가격 차트는 규모가 비슷한 부류(집합건물 / 단독·상가 / 토지)끼리만
  const family = (t: string) => (["apt", "officetel", "rowhouse"].includes(t) ? "unit" : t === "land" || t === "forest" ? "land" : "building");
  const charted = rows.filter((r) => r.trend.length >= 6);
  const mainFamily = charted[0] ? family(charted[0].it.property_type) : null;
  const absRows = charted.filter((r) => family(r.it.property_type) === mainFamily);
  const leftOut = rows.filter((r) => !charted.includes(r)).map((r) => r.it.label);
  const otherFamily = charted.filter((r) => !absRows.includes(r)).map((r) => r.it.label);
  const aiState = await aiStatus(uid);
  const enabled = aiState.enabled;

  type Row = (typeof rows)[number];
  const lastOfficial = (r: Row, types: string[]) => r.attrs.prices.filter((p) => types.includes(p.target_type)).at(-1) ?? null;
  const titleOf = (r: Row) => (r.attrs.building?.titles?.[0] ?? null) as { useAprDay?: string; mainPurpsCdNm?: string; grndFlrCnt?: string | number } | null;
  const metrics: { label: string; get: (r: Row) => string }[] = [
    { label: "유형", get: (r) => PROPERTY_TYPES[r.it.property_type].label },
    { label: "위치", get: (r) => r.it.umd_nm ?? (r.it.jibun_address ?? r.it.road_address ?? "-").split(" ").slice(-3, -1).join(" ") },
    { label: "면적", get: (r) => formatArea(r.it.area_m2 ?? r.it.land_area_m2, unit) },
    { label: "층·동호", get: (r) => [r.it.dong_ho, r.it.floor ? `${r.it.floor}층` : null].filter(Boolean).join(" · ") || "-" },
    { label: "매입가", get: (r) => (r.it.purchase_price ? formatManwon(r.it.purchase_price, { short: true }) : "-") },
    {
      label: "평가 손익",
      get: (r) => {
        const now = r.v?.estimate ?? r.s.lastSale?.price ?? null;
        if (!r.it.purchase_price || !now) return "-";
        return `${now >= r.it.purchase_price ? "+" : ""}${formatManwon(now - r.it.purchase_price, { short: true })} (${formatPct(now / r.it.purchase_price - 1)})`;
      },
    },
    { label: "최근 매매", get: (r) => (r.s.lastSale ? `${formatManwon(r.s.lastSale.price, { short: true })} · ${formatDate(r.s.lastSale.deal_date)}` : "-") },
    { label: "매매 건수(5년)", get: (r) => `${r.tradeCount}건` },
    { label: "추정 시세", get: (r) => (r.v ? `${formatManwon(r.v.estimate, { short: true })}` : "-") },
    { label: "추정 범위", get: (r) => (r.v ? `${formatManwon(r.v.low, { short: true })}~${formatManwon(r.v.high, { short: true })}` : "-") },
    { label: `${unitPriceName(unit)}(추정)`, get: (r) => formatManwon(r.ppy, { short: true }) },
    { label: "1년 변화", get: (r) => formatPct(r.s.change1y) },
    { label: "유사 단지 대비(평소)", get: (r) => (r.rel ? `${formatPct(r.rel.current, 0)} (${formatPct(r.rel.average, 0)}) · ${r.rel.verdict}` : "-") },
    { label: "전세가율", get: (r) => formatPct(r.s.jeonseRatio, 0, false) },
    { label: "최근 3개월 거래", get: (r) => `${r.s.count3m}건` },
    {
      label: "준공",
      get: (r) => {
        const y = r.it.complex_build_year ?? (titleOf(r)?.useAprDay ? Number(String(titleOf(r)!.useAprDay).slice(0, 4)) : null);
        return y ? `${y}년 (${new Date().getFullYear() - y}년차)` : "-";
      },
    },
    {
      label: "공시가격",
      get: (r) => {
        const u = lastOfficial(r, ["apt_unit", "house"]);
        if (u) return `${formatManwon(u.price / 10000, { short: true })} (${u.year})`;
        const l = lastOfficial(r, ["land"]);
        return l ? `${formatNumber(l.price)}원/㎡ (${l.year})` : "-";
      },
    },
    { label: "지목 · 용도지역", get: (r) => (r.attrs.parcel ? [r.attrs.parcel.jimok, r.attrs.parcel.land_use_zone?.[0]].filter(Boolean).join(" · ") || "-" : "-") },
    { label: "생활편의 점수", get: (r) => (r.loc?.total != null ? String(Math.round(r.loc.total)) : "-") },
    {
      label: "교통 / 직주근접 / 학교",
      get: (r) => (r.loc ? (["transit", "jobs", "school"] as const).map((k) => (r.loc!.scores[k]?.score != null ? Math.round(r.loc!.scores[k].score!) : "-")).join(" / ") : "-"),
    },
    { label: "주변 정비구역", get: (r) => (r.loc?.development?.zones_count != null ? `${r.loc.development.zones_count}곳` : "-") },
    { label: "신설역 거리", get: (r) => (r.loc?.development?.nearest_planned_station ? `${(r.loc.development.nearest_planned_station.dist_m / 1000).toFixed(1)}km` : "-") },
    { label: "지역 온도계", get: (r) => (r.temp != null ? String(Math.round(r.temp)) : "-") },
    { label: "지역 월부담지수", get: (r) => (r.burden != null ? `${r.burden.toFixed(0)}%` : "-") },
    { label: "뉴스 호재/악재(60일)", get: (r) => `${r.news?.pos ?? 0} / ${r.news?.neg ?? 0}` },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="비교" sub="최대 5개 부동산을 나란히 비교" />
      <div className="flex flex-wrap gap-1.5">
        {all.map((i) => (
          <Link key={i.id} href={toggle(i.id)} className={`rounded-full border px-3 py-1 text-[13px] ${ids.includes(i.id) ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted"}`}>
            {ids.includes(i.id) ? "✓ " : ""}
            {i.label}
          </Link>
        ))}
      </div>
      {rows.length < 2 ? (
        <Card><EmptyState title="2개 이상 선택하세요" /></Card>
      ) : (
        <>
          {rows.some((r) => !r.tradeCount && !r.v && !r.loc && !r.attrs.building && !r.attrs.parcel) ? (
            <Notice tone="warn">
              아직 공공데이터가 수집되지 않은 부동산이 있어 일부 칸이 비어 있습니다(
              {rows
                .filter((r) => !r.tradeCount && !r.v && !r.loc && !r.attrs.building && !r.attrs.parcel)
                .map((r) => r.it.label)
                .join(", ")}
              ). 각 부동산 개요의 &quot;데이터 상태&quot;에서 사유를 확인하고 다시 불러올 수 있습니다.
            </Notice>
          ) : null}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] whitespace-nowrap text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 bg-surface px-4 py-2 text-left text-xs font-medium text-muted">항목</th>
                    {rows.map((r) => (
                      <th key={r.it.id} className="px-3 py-2 text-right font-semibold">
                        <Link href={`/items/${r.it.id}`} className="hover:text-accent">{r.it.label}</Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {metrics.map((m) => (
                    <tr key={m.label} className="border-b border-border/60 last:border-0">
                      <td className="sticky left-0 bg-surface px-4 py-2 text-muted">{m.label}</td>
                      {rows.map((r) => (
                        <td key={r.it.id} className="px-3 py-2 text-right">{m.get(r)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={`${unitPriceName(unit)} 추이`} sub="매매 · 3개월 이동 중위 · 최근 5년" />
              <div className="px-2 pb-3">
                <LineSeriesChart lines={absRows.map((r) => ({ name: r.it.label, points: r.trend, slot: (rows.indexOf(r) + 1) as 1 | 2 | 3 | 4 | 5 }))} fmt="manwon" height={260} endLabels />
              </div>
            </Card>
            <Card>
              <CardHeader title="상대 성과" sub="공통 시작월 = 100 · 같은 기간 누가 더 올랐나" />
              <div className="px-2 pb-3">
                <LineSeriesChart
                  lines={rebase(charted.map((r) => r.trend)).map((points, i) => ({ name: charted[i].it.label, points, slot: (rows.indexOf(charted[i]) + 1) as 1 | 2 | 3 | 4 | 5 }))}
                  fmt="num1"
                  height={260}
                  endLabels
                />
              </div>
            </Card>
            {leftOut.length || otherFamily.length ? (
              <p className="text-xs text-muted lg:col-span-2">
                {otherFamily.length ? `${otherFamily.join(", ")}: 가격 규모가 달라 왼쪽 차트에서 빼고 상대 성과에만 표시했습니다. ` : ""}
                {leftOut.length ? `${leftOut.join(", ")}: 거래가 적어(6개월 미만) 추이 차트에서 뺐습니다.` : ""}
              </p>
            ) : null}
          </div>
          <Card>
            <CardHeader title="AI 비교" sub={ai ? `생성 ${ai.created_at.slice(0, 16).replace("T", " ")}` : "데이터 근거로 장단점과 조건별 적합도를 정리"} action={<CompareButton ids={ids} enabled={enabled} />} />
            {!enabled ? <div className="px-4 pb-4"><AiSetupNotice problem={aiState.problem} /></div> : null}
            {ai ? (
              <div className="space-y-4 px-4 pb-4 text-sm">
                <p className="text-[15px] font-medium">{ai.data.result.summary}</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {ai.data.result.items.map((x) => (
                    <div key={x.name} className="rounded-xl bg-surface-2 p-3">
                      <div className="mb-1 font-semibold">{x.name}</div>
                      <ul className="space-y-0.5">
                        {x.pros.map((p, i) => <li key={`p${i}`}>＋ {p}</li>)}
                        {x.cons.map((c, i) => <li key={`c${i}`} className="text-muted">－ {c}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
                {ai.data.result.fits.length ? (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">조건</th><th className="py-1 font-medium">더 부합</th><th className="py-1 font-medium">근거</th></tr></thead>
                    <tbody>
                      {ai.data.result.fits.map((f, i) => (
                        <tr key={i} className="border-t border-border/60 align-top"><td className="py-1.5 pr-2">{f.condition}</td><td className="py-1.5 pr-2 font-medium">{f.better}</td><td className="py-1.5">{f.reason}</td></tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {ai.data.result.watch_points.length ? <p className="text-xs text-muted">확인할 점: {ai.data.result.watch_points.join(" · ")}</p> : null}
                <AiReportButton surface="report" refId={`compare:${ids.join(",")}`} excerpt={JSON.stringify(ai.data.result)} />
              </div>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
