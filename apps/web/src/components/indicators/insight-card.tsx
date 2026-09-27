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
