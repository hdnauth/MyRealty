import clsx from "clsx";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { type Insight, insightBalance } from "@/lib/insights";

const ICON = { up: TrendingUp, down: TrendingDown, neutral: Minus } as const;

/** 지표 화면 맨 위: 금리·유동성·수급·전세 지표를 가격 방향 요인으로 해석 */
export function InsightCard({ insights, region }: { insights: Insight[]; region: string | null }) {
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
