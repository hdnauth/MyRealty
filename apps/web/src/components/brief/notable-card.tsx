import clsx from "clsx";
import { Card, CardHeader } from "@/components/ui";
import type { Signal } from "@/lib/brief";

const VALUE: Record<Signal["tone"], string> = { up: "text-up", down: "text-down", warn: "text-warn", neutral: "" };

/**
 * 눈여겨볼 지표: 실거래 세부 항목(층·계약구분·등기·매수자)과 조합 지표 중 이 부동산·지역에서 평소와 다른 것만.
 * 각 칸에 출처(어떤 공공데이터 항목인지)를 붙인다.
 */
export function NotableCard({ signals, className }: { signals: Signal[]; className?: string }) {
  if (!signals.length) return null;
  return (
    <Card className={className}>
      <CardHeader title="눈여겨볼 지표" sub="실거래 세부 항목과 조합 지표 중 평소와 다르게 나타나는 것만 골랐습니다" />
      <ul className="grid grid-cols-1 gap-px overflow-hidden border-t border-border bg-border sm:grid-cols-2">
        {signals.map((x) => (
          <li key={x.key} className="bg-surface px-4 py-3" data-signal={x.key}>
            <div className="text-xs text-muted">{x.label}</div>
            <div className={clsx("tabular mt-0.5 text-lg font-semibold", VALUE[x.tone])}>{x.value}</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{x.note}</p>
            <p className="mt-1 text-[0.75rem] text-muted/80">출처 · {x.source}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
