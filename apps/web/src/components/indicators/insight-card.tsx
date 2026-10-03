import clsx from "clsx";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { type Insight, insightBalance, type RuleRecord } from "@/lib/insights";

const ICON = { up: TrendingUp, down: TrendingDown, neutral: Minus } as const;

/** 지표 화면 맨 위: 금리·유동성·수급·전세 지표를 가격 방향 요인으로 해석 */
export function InsightCard({ insights, region, record }: { insights: Insight[]; region: string | null; record?: Map<string, RuleRecord> }) {
  if (!insights.length) return null;
  const b = insightBalance(insights);
  return (
    <Card>
      <CardHeader
        title={`시장 해석${region ? ` · ${region}` : ""}`}
        sub={
          <>
            가격 상승 요인 <b className="text-up">{b.up}</b> · 하락 요인 <b className="text-down">{b.down}</b> — {b.verdict}
          </>
        }
      />
      <ul className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 pb-4 md:grid-cols-2">
        {insights.map((x) => {
          const Icon = ICON[x.tone];
          return (
            <li key={x.key} className="flex gap-2.5">
              <span
                className={clsx(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  x.tone === "up" ? "bg-up/10 text-up" : x.tone === "down" ? "bg-down/10 text-down" : "bg-surface-2 text-muted",
                )}
              >
                <Icon size={14} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{x.title}</span>
                <span className="block text-[13px] leading-relaxed text-muted">{x.detail}</span>
                {(() => {
                  const r = x.tone === "neutral" ? undefined : record?.get(`${x.key}:${x.tone}`);
                  return r && r.n >= 6 ? (
                    <span className="mt-0.5 block text-[11px] text-muted">
                      이 지역 과거 {r.n}개월 신호 · 6개월 뒤 {x.tone === "up" ? "상승" : "하락"} 적중 {(r.hitRate * 100).toFixed(0)}%
                    </span>
                  ) : null;
                })()}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted">
        금리 → 대출 부담 → 거래 → 가격으로 이어지는 흐름을 규칙으로 판단한 참고 정보입니다. 투자 권유가 아닙니다.
      </p>
    </Card>
  );
}

/** 규칙별 과거 성적(이 지역): 신호가 났던 달 수, 6개월 뒤 가격지수 평균 변화, 방향 적중률 */
export function BacktestCard({ bt }: { bt: { horizon: number; months: number; baseUp: number; rules: RuleRecord[] } }) {
  const rows = bt.rules.filter((r) => r.n >= 6);
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader
        title="해석 규칙의 과거 성적"
        sub={`이 지역 ${bt.months}개월을 그 시점 데이터만으로 다시 판단 · ${bt.horizon}개월 뒤 가격지수로 채점 · 같은 기간 상승 비율 ${(bt.baseUp * 100).toFixed(0)}%`}
      />
      <div className="overflow-x-auto pb-2">
        <table className="w-full min-w-[480px] whitespace-nowrap text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-2 font-medium">규칙</th>
              <th className="px-2 py-2 text-right font-medium">신호(개월)</th>
              <th className="px-2 py-2 text-right font-medium">{bt.horizon}개월 뒤 평균</th>
              <th className="px-4 py-2 text-right font-medium">방향 적중</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2">
                  <span className={clsx("mr-1.5 inline-block h-2 w-2 rounded-full", r.tone === "up" ? "bg-up" : "bg-down")} />
                  {r.title}
                </td>
                <td className="px-2 py-2 text-right">{r.n}</td>
                <td className={clsx("px-2 py-2 text-right", r.avgForward > 0 ? "text-up" : r.avgForward < 0 ? "text-down" : "")}>
                  {r.avgForward > 0 ? "+" : ""}
                  {(r.avgForward * 100).toFixed(1)}%
                </td>
                <td className="px-4 py-2 text-right font-medium">{(r.hitRate * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted">
        이웃한 달의 신호는 기간이 겹치고, 지역 데이터가 짧으면 표본이 적습니다. 기준값을 조정할 때 참고하는 자료입니다.
      </p>
    </Card>
  );
}

/**
 * 기본 보기의 지표 첫 카드: 판정 한 줄 → 이유 세 가지(과거 적중률이 높은 순) → 이 판정을 얼마나 믿을 수 있는지.
 * 나머지 요인은 접어 둔다.
 */
export function MarketVerdictCard({
  insights,
  ranked,
  region,
  record,
  signal,
  temp,
  band,
}: {
  insights: Insight[];
  ranked: Insight[];
  region: string | null;
  record?: Map<string, RuleRecord>;
  signal: { hitRate: number; base: number; signals: number; months: number } | null;
  temp: number | null;
  band: { label: string; tone: "up" | "down" | "neutral" };
}) {
  if (!insights.length) return null;
  const b = insightBalance(insights);
  const top = ranked.filter((x) => x.tone !== "neutral").slice(0, 3);
  const rest = insights.length - top.length;
  const tone = b.up - b.down >= 2 ? "text-up" : b.down - b.up >= 2 ? "text-down" : "";
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{region ? `${region} 시장 판정` : "시장 판정"}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={clsx("text-2xl font-bold tracking-tight", tone)}>{b.verdict}</span>
        {temp !== null ? (
          <span className="text-sm text-muted">
            시장 온도 <b className="text-text">{Math.round(temp)}</b> · {band.label}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted">
        가격을 올리는 요인 <b className="text-up">{b.up}</b> · 내리는 요인 <b className="text-down">{b.down}</b>
      </p>
      {top.length ? (
        <ol className="mt-4 space-y-3">
          {top.map((x, i) => {
            const Icon = ICON[x.tone];
            const r = record?.get(`${x.key}:${x.tone}`);
            return (
              <li key={x.key} className="flex gap-2.5">
                <span className={clsx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", x.tone === "up" ? "bg-up/10 text-up" : "bg-down/10 text-down")}>
                  <Icon size={14} aria-label={`${i + 1}`} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{x.title}</span>
                  <span className="block text-[13px] leading-relaxed text-muted">{x.detail}</span>
                  {r && r.n >= 6 ? (
                    <span className="mt-0.5 block text-[11px] text-muted">
                      이 지역에서 이 신호가 났던 {r.n}개월 중 6개월 뒤 {x.tone === "up" ? "올랐던" : "내렸던"} 비율 {(r.hitRate * 100).toFixed(0)}%
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted">뚜렷하게 가격을 밀거나 당기는 요인이 없습니다.</p>
      )}
      {signal ? (
        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-muted">
          이 판정은 얼마나 맞았나: 지금 켜진 신호 {signal.signals}개는 이 지역 과거 {signal.months}개월 동안 6개월 뒤 방향을{" "}
          <b className="text-text">{(signal.hitRate * 100).toFixed(0)}%</b> 맞혔습니다(아무 때나 같은 방향으로 찍으면 {(signal.base * 100).toFixed(0)}%).
        </p>
      ) : null}
      {rest > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-accent">요인 모두 보기 ({insights.length})</summary>
          <div className="mt-3">
            <InsightCard insights={insights} region={region} record={record} />
          </div>
        </details>
      ) : null}
      <p className="mt-3 text-[11px] text-muted">금리 → 대출 부담 → 거래 → 가격 흐름을 규칙으로 판단한 참고 정보입니다. 투자 권유가 아닙니다.</p>
    </Card>
  );
}
