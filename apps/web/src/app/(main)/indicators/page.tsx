import type { Metadata } from "next";
import Link from "next/link";
import { LineSeriesChart, Sparkline } from "@/components/charts/series-chart";
import { SentimentCard } from "@/components/community/sentiment-card";
import { ContribBars } from "@/components/indicators/contrib-bars";
import { type JeonseItemOption, JeonseCheck } from "@/components/indicators/jeonse-check";
import { BacktestCard, InsightCard, MarketVerdictCard } from "@/components/indicators/insight-card";
import { ViewModeToggle } from "@/components/shell/view-mode-toggle";
import { getViewMode } from "@/lib/view-mode";
import { Simulator } from "@/components/indicators/simulator";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader, Stat, Tabs } from "@/components/ui";
import { Term } from "@/components/ui/term";
import { pageUser, sessionUserId } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatManwon, formatPct } from "@/lib/format";
import { backtestInsights, marketInsights, MIN_BACKTEST_MONTHS, rankInsights, signalRecord } from "@/lib/insights";
import { change, INSIGHT_REGION_KEYS, indicatorRegions, MACRO_CODES, last, type Point, seriesMeta, seriesValues, TEMP_FACTORS, tempBand } from "@/lib/queries/indicators";
import { listItems } from "@/lib/queries/items";
import { pipelineHints } from "@/lib/queries/pipeline";

export const metadata: Metadata = { title: "시장 지표" };

function yoy(points: Point[]): Point[] {
  const m = new Map(points.map(([d, v]) => [d, v]));
  return points.flatMap(([d, v]) => {
    const prev = m.get(`${Number(d.slice(0, 4)) - 1}${d.slice(4)}`);
    return prev ? ([[d, (v / prev - 1) * 100]] as Point[]) : [];
  });
}

const view0 = (x: unknown) => (typeof x === "string" ? x : "summary");

const VIEWS = [
  { key: "summary", label: "요약" },
  { key: "price", label: "가격·거래" },
  { key: "burden", label: "부담" },
  { key: "macro", label: "금리·물가" },
  { key: "tools", label: "계산기" },
] as const;

/** 월 시계열의 n개월 합계 */
function rollingSum(p: Point[], n: number): Point[] {
  return p.flatMap(([d], i) => (i >= n - 1 ? ([[d, p.slice(i - n + 1, i + 1).reduce((a, [, x]) => a + x, 0)]] as Point[]) : []));
}

/** 두 월 시계열의 차(같은 달끼리) */
function spread(a: Point[], b: Point[]): Point[] {
  const m = new Map(b.map(([d, x]) => [d, x]));
  return a.flatMap(([d, x]) => (m.has(d) ? ([[d, x - m.get(d)!]] as Point[]) : []));
}

export default async function IndicatorsPage(props: PageProps<"/indicators">) {
  const [uid, sp] = await Promise.all([sessionUserId(), props.searchParams]);
  const since = new Date(new Date().getFullYear() - 8, 0, 1).toISOString().slice(0, 10);
  const macroCodes = MACRO_CODES;
  // 지역 목록이 있어야 정해지는 지역 지표만 다음 단계로 두고 나머지는 한 번에 조회
  const [user, regions, macroV, meta, items, official, mode] = await Promise.all([
    pageUser(uid),
    indicatorRegions(uid),
    seriesValues(macroCodes, since),
    seriesMeta(macroCodes),
    listItems(uid),
    // 깡통전세 점검용: 관심 부동산 공시가격
    sql<{ id: string; price: number }[]>`
      select distinct on (w.id) w.id, o.price from watch_items w
      join official_prices o on o.target_key = w.pnu or o.target_key like w.pnu || '|%'
      where w.user_id = ${uid} and o.target_type in ('apt_unit', 'house')
      order by w.id, o.year desc`,
    getViewMode(),
  ]);
  const sgg = regions.find((r) => r.sgg === sp.sgg)?.sgg ?? regions[0]?.sgg;

  const regionCodes = sgg
    ? ["idx", "vol", "med84", "jr", "nhr", "dr", "jgap", "rrr", "corp", "unreg", "direct"].map((k) => `${k}.${sgg}`).concat(
        ["burden", "pir", "real", "liq", "turnover", "temp", "supply"].map((k) => `ind.${k}.${sgg}`),
        TEMP_FACTORS.map((f) => `ind.temp_c.${f.key}.${sgg}`),
      )
    : [];
  const macroEmpty = !Object.values(macroV).some((p) => p.length);
  const [regionV, tradeHints, macroHints] = await Promise.all([
    seriesValues(regionCodes, since),
    !sgg && view0(sp.view) !== "macro" && view0(sp.view) !== "tools" ? pipelineHints("trades") : Promise.resolve([]),
    macroEmpty ? pipelineHints("macro") : Promise.resolve([]),
  ]);
  const v = { ...macroV, ...regionV };
  const r = (k: string) => v[`${k}.${sgg}`] ?? [];

  const view = VIEWS.find((x) => x.key === sp.view)?.key ?? "summary";
  const insightInput = { ...v, ...Object.fromEntries(INSIGHT_REGION_KEYS.map((k) => [k, r(k)])) };
  const insights = marketInsights(insightInput);
  const bt = view === "summary" ? backtestInsights(insightInput) : null;
  // 채점 기간이 짧으면 규칙별 적중률을 해석 옆에 붙이지 않는다(표는 전문 보기에서 그대로)
  const record = new Map((bt && bt.months >= MIN_BACKTEST_MONTHS ? bt.rules : []).map((x) => [x.id, x]));
  const ranked = rankInsights(insights, bt);
  const signal = signalRecord(insights, bt);
  const pro = mode === "pro";
  // 최근 달은 신고 기한(30일) 때문에 덜 잡힌다 — 기본 보기는 3개월 평균으로
  const thisMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  const volPts = r("vol").filter(([d]) => d < thisMonth).slice(-3);
  const vol3 = volPts.length ? volPts.reduce((a, [, x]) => a + x, 0) / volPts.length : null;
  const regionName = regions.find((g) => g.sgg === sgg)?.name ?? null;

  const temp = last(r("ind.temp"));
  const band = tempBand(temp);
  const contribs = TEMP_FACTORS.map((f) => ({ label: f.label, value: last(r(`ind.temp_c.${f.key}`)) }));
  const mortgage = last(v["ecos.mortgage_rate"]) ?? (last(v["ecos.base_rate"]) ?? 2.5) + 1.7;

  const jeonseItems: JeonseItemOption[] = items
    .filter((i) => ["apt", "officetel", "rowhouse", "house"].includes(i.property_type))
    .map((i) => ({ id: i.id, label: i.label, market: i.estimate ?? i.last_trade_price, official: (official.find((o) => o.id === i.id)?.price ?? 0) / 10000 || null }));
  const defaultPrice = last(r("med84")) ?? items[0]?.last_trade_price ?? 100000;
  const q = (o: { sgg?: string; view?: string }) => {
    const u = new URLSearchParams();
    if (o.sgg ?? sgg) u.set("sgg", (o.sgg ?? sgg)!);
    if ((o.view ?? view) !== "summary") u.set("view", o.view ?? view);
    return `/indicators${u.size ? `?${u}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="시장 지표"
        sub="실거래로 만든 자체 가격지수와 금리·물가·유동성을 조합한 지표"
        action={<Link href="/indicators/custom" className="shrink-0 text-sm text-accent">커스텀 지표 →</Link>}
      />
      {regions.length ? (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
          {regions.map((g) => (
            <Link
              key={g.sgg}
              href={q({ sgg: g.sgg })}
              className={`shrink-0 rounded-full border px-3 py-1 text-[13px] ${g.sgg === sgg ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted"}`}
            >
              {g.name.split(" ").at(-1)}
            </Link>
          ))}
        </div>
      ) : null}

      <Tabs active={view} items={VIEWS.map((x) => ({ ...x, href: q({ view: x.key }) }))} />

      {view === "summary" && pro ? <InsightCard insights={insights} region={regionName} record={record} /> : null}
      {view === "summary" && !pro && sgg ? (
        <MarketVerdictCard insights={insights} ranked={ranked} region={regionName} record={record} signal={signal} temp={temp} band={band} />
      ) : null}

      {view === "macro" || view === "tools" ? null : !sgg ? (
        <Card>
          <EmptyState title="아직 계산된 지역 지표가 없습니다" desc="관심 부동산이 있는 시군구의 아파트 실거래가 30건 이상 모이면 매일 수집(또는 부동산 '다시 불러오기') 때 계산됩니다." />
          {user?.isAdmin && tradeHints.length ? (
            <div className="space-y-1.5 px-4 pb-4">
              {tradeHints.map((h) => (
                <Notice key={h} tone="warn">{h}</Notice>
              ))}
            </div>
          ) : null}
        </Card>
      ) : (
        <>
          {view === "summary" && !pro ? (
            <Card className="p-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="가격 1년 변화" value={formatPct(change(r("idx"), 12))} sub={<span className="text-muted">최근 3개월 {formatPct(change(r("idx"), 3))}</span>} />
                <Stat label="84㎡ 아파트 중간 가격" value={formatManwon(last(r("med84")), { short: true })} />
                <Stat label="전세가 ÷ 매매가" value={formatPct(last(r("jr")), 1, false)} sub={<span className="text-muted">높을수록 갭이 작음</span>} />
                <Stat label="월 매매(최근 3개월 평균)" value={vol3 !== null ? `${Math.round(vol3).toLocaleString()}건` : "-"} sub={<span className="text-muted">집계 중인 이번 달 제외</span>} />
              </div>
            </Card>
          ) : null}
          {view === "summary" ? (
          <details open={pro} className="group">
          <summary className={pro ? "hidden" : "cursor-pointer px-1 text-sm font-medium text-accent"}>숫자로 더 보기 — 온도계 구성·조합 지표·규칙별 과거 성적</summary>
          <div className={pro ? "space-y-4" : "mt-4 space-y-4"}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-muted"><Term k="temp">시장 온도계</Term></div>
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
                <Stat label={<Term k="idx">가격지수 12개월</Term>} value={formatPct(change(r("idx"), 12))} sub={<span className="text-muted">3개월 {formatPct(change(r("idx"), 3))}</span>} />
                <Stat label={<Term k="med84">84㎡ 중위가</Term>} value={formatManwon(last(r("med84")), { short: true })} />
                <Stat label={<Term k="burden">월부담지수</Term>} value={last(r("ind.burden")) !== null ? `${last(r("ind.burden"))!.toFixed(0)}%` : "-"} sub={<span className="text-muted">월소득 대비 원리금</span>} />
                <Stat label={<Term k="pir">PIR</Term>} value={last(r("ind.pir")) !== null ? `${last(r("ind.pir"))!.toFixed(1)}배` : "-"} sub={<span className="text-muted">연소득 대비</span>} />
                <Stat label={<Term k="jr">전세가율</Term>} value={formatPct(last(r("jr")), 1, false)} />
                <Stat label={<Term k="turnover">월 매매 건수</Term>} value={last(r("vol")) !== null ? `${last(r("vol"))}건` : "-"} sub={<span className="text-muted">회전율 {last(r("ind.turnover"))?.toFixed(2) ?? "-"}‰</span>} />
                <Stat label={<Term k="nhr">신고가 / 하락 비율</Term>} value={`${formatPct(last(r("nhr")), 0, false)} / ${formatPct(last(r("dr")), 0, false)}`} sub={<span className="text-muted">최근 3개월</span>} />
                <Stat label={<Term k="supply">공급압력(24개월)</Term>} value={last(r("ind.supply")) !== null ? `${last(r("ind.supply"))!.toFixed(1)}%` : "-"} sub={<span className="text-muted">입주예정/재고</span>} />
              </div>
            </Card>
          </div>
          {bt ? <BacktestCard bt={bt} /> : null}
          </div>
          </details>
          ) : null}
          {view === "summary" ? (
            <div>
              <SentimentCard sgg={sgg} region={regionName} />
              <p className="mt-2 text-right text-xs"><Link href={`/community?sgg=${sgg}`} className="text-accent">{regionName ?? "이 지역"} 동네 이야기 →</Link></p>
            </div>
          ) : null}

          {view === "price" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={<><Term k="real">가격지수 · 실질 · 유동성 보정</Term></>} sub="시작월 = 100 · 실질 = 물가 보정, 유동성 = M2 대비" />
              <div className="px-2 pb-3">
                <LineSeriesChart
                  lines={[
                    { name: "명목 지수", points: r("idx"), slot: 1 },
                    { name: "실질(물가 보정)", points: r("ind.real"), slot: 2 },
                    { name: "M2 대비", points: r("ind.liq"), slot: 3 },
                  ]}
                  endLabels
                />
              </div>
            </Card>
            <Card>
              <CardHeader title={<Term k="temp">시장 온도계 추이</Term>} sub="0~100" />
              <div className="px-2 pb-3">
                <LineSeriesChart lines={[{ name: "온도계", points: r("ind.temp") }]} fmt="num" yMin={0} yMax={100} bands={[20, 40, 60, 80]} />
              </div>
            </Card>
            <Card>
              <CardHeader title={<Term k="turnover">월 매매 건수</Term>} />
              <div className="px-2 pb-3"><LineSeriesChart lines={[{ name: "매매 건수", points: r("vol") }]} fmt="num" kind="bar" /></div>
            </Card>
            <Card>
              <CardHeader title={<Term k="nhr">신고가 · 하락 거래 비율 · 전세가율</Term>} sub="최근 3개월 이동" />
              <div className="px-2 pb-3">
                <LineSeriesChart
                  lines={[
                    { name: "신고가 비율", points: r("nhr"), slot: 1 },
                    { name: "하락 거래 비율", points: r("dr"), slot: 2 },
                    { name: "전세가율", points: r("jr"), slot: 3 },
                  ]}
                  fmt="ratio"
                  endLabels
                />
              </div>
            </Card>
            <Card>
              <CardHeader title={<Term k="deal_quality">거래의 질</Term>} sub="법인 매수 · 직거래 비중(3개월) · 미등기 신고가 비율(6개월)" />
              <div className="px-2 pb-3">
                <LineSeriesChart
                  lines={[
                    { name: "법인 매수", points: r("corp"), slot: 1 },
                    { name: "직거래", points: r("direct"), slot: 2 },
                    { name: "미등기 신고가", points: r("unreg"), slot: 3 },
                  ]}
                  fmt="ratio"
                  endLabels
                />
              </div>
            </Card>
            <Card>
              <CardHeader
                title={<Term k="jgap">신규 전세 − 갱신 전세</Term>}
                sub={`같은 시기 신규 계약이 갱신 계약보다 몇 % 비싼지(3개월)${last(r("rrr")) !== null ? ` · 갱신요구권 사용 ${formatPct(last(r("rrr")), 0, false)}` : ""}`}
              />
              <div className="px-2 pb-3">
                <LineSeriesChart lines={[{ name: "신규−갱신 괴리", points: r("jgap") }]} fmt="pct100" bands={[0]} />
              </div>
            </Card>
          </div>
          ) : null}

          {view === "burden" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={<Term k="burden">월부담지수</Term>} sub={`84㎡ 중위가 × LTV 50% · 30년 원리금 / 월소득 · 주담대 금리 반영`} />
              <div className="px-2 pb-3"><LineSeriesChart lines={[{ name: "월부담지수", points: r("ind.burden") }]} fmt="num1" /></div>
            </Card>
            <Card>
              <CardHeader title={<Term k="pir">PIR(소득 대비 가격)</Term>} sub="84㎡ 중위가 / 가구 연소득" />
              <div className="px-2 pb-3"><LineSeriesChart lines={[{ name: "PIR", points: r("ind.pir") }]} fmt="num1" /></div>
            </Card>
          </div>
          ) : null}
        </>
      )}

      {macroEmpty && (view === "macro" || view === "summary") ? (
        <Notice tone="warn">
          금리·물가·통화량 자료를 준비하고 있습니다. 매일 아침 자동으로 수집됩니다.
          {/* 수집 설정 문제(키·작업 실패)는 운영자에게만 */}
          {(user?.isAdmin ? macroHints : []).map((h) => (
            <span key={h} className="mt-1 block">
              {h}
            </span>
          ))}
        </Notice>
      ) : null}

      {view === "macro" ? (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={<Term k="mortgage">금리</Term>} sub={[meta["ecos.base_rate"]?.source === "demo" ? "데모 데이터" : "한국은행 ECOS"].join("")} />
          <div className="px-2 pb-3">
            <LineSeriesChart
              lines={[
                { name: "기준금리", points: v["ecos.base_rate"] ?? [], slot: 1 },
                { name: "주담대(신규)", points: v["ecos.mortgage_rate"] ?? [], slot: 2 },
                { name: "국고채 3년", points: v["ecos.bond_3y"] ?? [], slot: 3 },
              ]}
              fmt="pct"
              endLabels
            />
          </div>
        </Card>
        <Card>
          <CardHeader title={<Term k="curve">시장이 보는 금리 방향</Term>} sub="국고채 3년 − 기준금리(%p) · 0 아래면 인하 기대" />
          <div className="px-2 pb-3">
            <LineSeriesChart lines={[{ name: "금리 차", points: spread(v["ecos.bond_3y"] ?? [], v["ecos.base_rate"] ?? []) }]} fmt="pct" bands={[0]} />
          </div>
        </Card>
        {(v["ecos.housing_csi"]?.length ?? 0) + (v["reb.supply_demand"]?.length ?? 0) > 0 ? (
          <Card>
            <CardHeader title={<Term k="sentiment">수요 심리</Term>} sub="주택가격전망 CSI · 아파트 매매수급지수 · 100 = 중립" />
            <div className="px-2 pb-3">
              <LineSeriesChart
                lines={[
                  { name: "주택가격전망 CSI", points: v["ecos.housing_csi"] ?? [], slot: 1 },
                  { name: "매매수급지수", points: v["reb.supply_demand"] ?? [], slot: 2 },
                ]}
                fmt="num"
                bands={[100]}
                endLabels
              />
            </div>
          </Card>
        ) : null}
        {v["ecos.household_mortgage"]?.length ? (
          <Card>
            <CardHeader title={<Term k="credit">주택담보대출 증가율</Term>} sub="잔액 전년 동월 대비(%)" />
            <div className="px-2 pb-3">
              <LineSeriesChart lines={[{ name: "주담대 잔액 증가율", points: yoy(v["ecos.household_mortgage"]) }]} fmt="pct" bands={[0]} />
            </div>
          </Card>
        ) : null}
        {v["kosis.permits"]?.length ? (
          <Card>
            <CardHeader title={<Term k="pipeline">주택 인허가(12개월 합계)</Term>} sub="3~4년 뒤 입주 물량의 선행 지표 · 전국" />
            <div className="px-2 pb-3">
              <LineSeriesChart lines={[{ name: "인허가 12개월 합", points: rollingSum(v["kosis.permits"], 12) }]} fmt="num" />
            </div>
          </Card>
        ) : null}
        {v["kosis.unsold_done"]?.length ? (
          <Card>
            <CardHeader title={<Term k="unsold">준공 후 미분양</Term>} sub="다 짓고도 팔리지 않은 집 · 전국(호)" />
            <div className="px-2 pb-3">
              <LineSeriesChart lines={[{ name: "준공 후 미분양", points: v["kosis.unsold_done"] }]} fmt="num" kind="bar" />
            </div>
          </Card>
        ) : null}
        <Card>
          <CardHeader title={<Term k="liq">물가 · 통화량 증가율</Term>} sub="전년 동월 대비(%)" />
          <div className="px-2 pb-3">
            <LineSeriesChart
              lines={[
                { name: "CPI", points: yoy(v["ecos.cpi"] ?? []), slot: 1 },
                { name: "M2", points: yoy(v["ecos.m2"] ?? []), slot: 2 },
              ]}
              fmt="pct"
              endLabels
            />
          </div>
        </Card>
      </div>
      ) : null}

      {view === "tools" || view === "burden" ? <Simulator defaultPrice={defaultPrice} defaultRate={mortgage} defaultIncome={7185} /> : null}
      {view === "tools" ? <JeonseCheck items={jeonseItems} /> : null}
      <ViewModeToggle mode={mode} what="온도계 구성·회귀·과거 성적 표" />
    </div>
  );
}
