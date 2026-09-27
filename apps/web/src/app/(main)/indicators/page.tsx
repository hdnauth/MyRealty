import type { Metadata } from "next";
import Link from "next/link";
import { LineSeriesChart, Sparkline } from "@/components/charts/series-chart";
import { ContribBars } from "@/components/indicators/contrib-bars";
import { type JeonseItemOption, JeonseCheck } from "@/components/indicators/jeonse-check";
import { Simulator } from "@/components/indicators/simulator";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatManwon, formatPct } from "@/lib/format";
import { change, indicatorRegions, last, type Point, seriesMeta, seriesValues, TEMP_FACTORS, tempBand } from "@/lib/queries/indicators";
import { listItems } from "@/lib/queries/items";

export const metadata: Metadata = { title: "지표" };

function yoy(points: Point[]): Point[] {
  const m = new Map(points.map(([d, v]) => [d, v]));
  return points.flatMap(([d, v]) => {
    const prev = m.get(`${Number(d.slice(0, 4)) - 1}${d.slice(4)}`);
    return prev ? ([[d, (v / prev - 1) * 100]] as Point[]) : [];
  });
}

export default async function IndicatorsPage(props: PageProps<"/indicators">) {
  const [uid, sp] = await Promise.all([sessionUserId(), props.searchParams]);
  const since = new Date(new Date().getFullYear() - 8, 0, 1).toISOString().slice(0, 10);
  const macroCodes = ["ecos.base_rate", "ecos.mortgage_rate", "ecos.bond_3y", "ecos.cpi", "ecos.m2"];
  // 지역 목록이 있어야 정해지는 지역 지표만 다음 단계로 두고 나머지는 한 번에 조회
  const [, regions, macroV, meta, items, official] = await Promise.all([
    requireUser(),
    indicatorRegions(uid),
    seriesValues(macroCodes, since),
    seriesMeta(macroCodes),
    listItems(uid),
    // 깡통전세 점검용: 내 부동산 공시가격
    sql<{ id: string; price: number }[]>`
      select distinct on (w.id) w.id, o.price from watch_items w
      join official_prices o on o.target_key = w.pnu or o.target_key like w.pnu || '|%'
      where w.user_id = ${uid} and o.target_type in ('apt_unit', 'house')
      order by w.id, o.year desc`,
  ]);
  const sgg = regions.find((r) => r.sgg === sp.sgg)?.sgg ?? regions[0]?.sgg;

  const regionCodes = sgg
    ? ["idx", "vol", "med84", "jr", "nhr", "dr"].map((k) => `${k}.${sgg}`).concat(
        ["burden", "pir", "real", "liq", "turnover", "temp", "supply"].map((k) => `ind.${k}.${sgg}`),
        TEMP_FACTORS.map((f) => `ind.temp_c.${f.key}.${sgg}`),
      )
    : [];
  const v = { ...macroV, ...(await seriesValues(regionCodes, since)) };
  const r = (k: string) => v[`${k}.${sgg}`] ?? [];

  const temp = last(r("ind.temp"));
  const band = tempBand(temp);
  const contribs = TEMP_FACTORS.map((f) => ({ label: f.label, value: last(r(`ind.temp_c.${f.key}`)) }));
  const mortgage = last(v["ecos.mortgage_rate"]) ?? (last(v["ecos.base_rate"]) ?? 2.5) + 1.7;

  const jeonseItems: JeonseItemOption[] = items
    .filter((i) => ["apt", "officetel", "rowhouse", "house"].includes(i.property_type))
    .map((i) => ({ id: i.id, label: i.label, market: i.estimate ?? i.last_trade_price, official: (official.find((o) => o.id === i.id)?.price ?? 0) / 10000 || null }));
  const defaultPrice = last(r("med84")) ?? items[0]?.last_trade_price ?? 100000;

  return (
    <div className="space-y-4">
      <PageHeader
        title="지표"
        sub="실거래로 만든 자체 가격지수와 금리·물가·유동성을 조합한 지표"
        action={<Link href="/indicators/custom" className="shrink-0 text-sm text-accent">커스텀 지표 →</Link>}
      />
      {regions.length ? (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
          {regions.map((g) => (
            <Link
              key={g.sgg}
              href={`/indicators?sgg=${g.sgg}`}
              className={`shrink-0 rounded-full border px-3 py-1 text-[13px] ${g.sgg === sgg ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted"}`}
            >
              {g.name.split(" ").at(-1)}
              {g.mine ? " ★" : ""}
            </Link>
          ))}
        </div>
      ) : null}

      {!sgg ? (
        <Card>
          <EmptyState title="아직 계산된 지역 지표가 없습니다" desc="관심 부동산을 등록하고 실거래가 수집되면 ETL indicators 단계에서 계산됩니다." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-muted">시장 온도계</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-4xl font-bold">{temp !== null ? Math.round(temp) : "-"}</span>
                    <Badge tone={band.tone}>{band.label}</Badge>
                  </div>
                </div>
                <div className="w-28"><Sparkline points={r("ind.temp").slice(-24)} /></div>
              </div>
              <div className="mt-4 text-xs text-muted">요인별 기여(z, +는 온도 상승)</div>
              <div className="mt-2">
                <ContribBars rows={contribs} />
              </div>
              <p className="mt-3 text-[11px] text-muted">0~20 냉각 · 20~40 약세 · 40~60 중립 · 60~80 강세 · 80~100 과열. 과거 분포 대비 z-score 합성.</p>
            </Card>
            <Card className="p-4 lg:col-span-2">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="가격지수 12개월" value={formatPct(change(r("idx"), 12))} sub={<span className="text-muted">3개월 {formatPct(change(r("idx"), 3))}</span>} />
                <Stat label="84㎡ 중위가" value={formatManwon(last(r("med84")), { short: true })} />
                <Stat label="월부담지수" value={last(r("ind.burden")) !== null ? `${last(r("ind.burden"))!.toFixed(0)}%` : "-"} sub={<span className="text-muted">월소득 대비 원리금</span>} />
                <Stat label="PIR" value={last(r("ind.pir")) !== null ? `${last(r("ind.pir"))!.toFixed(1)}배` : "-"} sub={<span className="text-muted">연소득 대비</span>} />
                <Stat label="전세가율" value={formatPct(last(r("jr")), 1, false)} />
                <Stat label="월 매매 건수" value={last(r("vol")) !== null ? `${last(r("vol"))}건` : "-"} sub={<span className="text-muted">회전율 {last(r("ind.turnover"))?.toFixed(2) ?? "-"}‰</span>} />
                <Stat label="신고가 / 하락 비율" value={`${formatPct(last(r("nhr")), 0, false)} / ${formatPct(last(r("dr")), 0, false)}`} sub={<span className="text-muted">최근 3개월</span>} />
                <Stat label="공급압력(24개월)" value={last(r("ind.supply")) !== null ? `${last(r("ind.supply"))!.toFixed(1)}%` : "-"} sub={<span className="text-muted">입주예정/재고</span>} />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="가격지수 · 실질 · 유동성 보정" sub="시작월 = 100 · 실질 = 물가 보정, 유동성 = M2 대비" />
              <div className="px-2 pb-3">
                <LineSeriesChart
                  lines={[
                    { name: "명목 지수", points: r("idx"), slot: 1 },
                    { name: "실질(물가 보정)", points: r("ind.real"), slot: 2 },
                    { name: "M2 대비", points: r("ind.liq"), slot: 3 },
                  ]}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="시장 온도계 추이" sub="0~100" />
              <div className="px-2 pb-3">
                <LineSeriesChart lines={[{ name: "온도계", points: r("ind.temp") }]} fmt="num" yMin={0} yMax={100} bands={[20, 40, 60, 80]} />
              </div>
            </Card>
            <Card>
              <CardHeader title="월부담지수" sub={`84㎡ 중위가 × LTV 50% · 30년 원리금 / 월소득 · 주담대 금리 반영`} />
              <div className="px-2 pb-3"><LineSeriesChart lines={[{ name: "월부담지수", points: r("ind.burden") }]} fmt="num1" /></div>
            </Card>
            <Card>
              <CardHeader title="PIR(소득 대비 가격)" sub="84㎡ 중위가 / 가구 연소득" />
              <div className="px-2 pb-3"><LineSeriesChart lines={[{ name: "PIR", points: r("ind.pir") }]} fmt="num1" /></div>
            </Card>
            <Card>
              <CardHeader title="월 매매 건수" />
              <div className="px-2 pb-3"><LineSeriesChart lines={[{ name: "매매 건수", points: r("vol") }]} fmt="num" kind="bar" /></div>
            </Card>
            <Card>
              <CardHeader title="신고가 · 하락 거래 비율 · 전세가율" sub="최근 3개월 이동" />
              <div className="px-2 pb-3">
                <LineSeriesChart
                  lines={[
                    { name: "신고가 비율", points: r("nhr"), slot: 1 },
                    { name: "하락 거래 비율", points: r("dr"), slot: 2 },
                    { name: "전세가율", points: r("jr"), slot: 3 },
                  ]}
                  fmt="ratio"
                />
              </div>
            </Card>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="금리" sub={[meta["ecos.base_rate"]?.source === "demo" ? "데모 데이터" : "한국은행 ECOS"].join("")} />
          <div className="px-2 pb-3">
            <LineSeriesChart
              lines={[
                { name: "기준금리", points: v["ecos.base_rate"] ?? [], slot: 1 },
                { name: "주담대(신규)", points: v["ecos.mortgage_rate"] ?? [], slot: 2 },
                { name: "국고채 3년", points: v["ecos.bond_3y"] ?? [], slot: 3 },
              ]}
              fmt="pct"
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="물가 · 통화량 증가율" sub="전년 동월 대비(%)" />
          <div className="px-2 pb-3">
            <LineSeriesChart
              lines={[
                { name: "CPI", points: yoy(v["ecos.cpi"] ?? []), slot: 1 },
                { name: "M2", points: yoy(v["ecos.m2"] ?? []), slot: 2 },
              ]}
              fmt="pct"
            />
          </div>
        </Card>
      </div>

      <Simulator defaultPrice={defaultPrice} defaultRate={mortgage} defaultIncome={7185} />
      <JeonseCheck items={jeonseItems} />
    </div>
  );
}
