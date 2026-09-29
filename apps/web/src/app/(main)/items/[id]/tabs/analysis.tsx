import { Check, CircleAlert, ListChecks, Minus, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader, EmptyState, Notice, Stat } from "@/components/ui";
import { latestAnalysis } from "@/lib/ai/analysis";
import { aiEnabled } from "@/lib/ai/client";
import { sql } from "@/lib/db";
import { formatDate, formatManwon, formatPct } from "@/lib/format";
import type { WatchItem } from "@/lib/queries/items";
import { AnalyzeButton } from "./analyze-button";

const METHOD: Record<string, string> = {
  same_complex: "같은 단지 거래(시점·층 보정)",
  neighbor_complexes: "인근 유사 단지 평당가",
  hedonic: "지역 헤도닉 회귀",
  land_unit_median: "같은 읍면동 ㎡당 중위",
};

/** land_unit_median:리·동 처럼 범위가 붙은 방법 이름 */
function methodLabel(m: string) {
  const [base, scope] = m.split(":");
  if (base === "same_complex" && scope === "guessed_area") return "같은 단지 거래 — 평형 미선택이라 가장 많이 거래된 평형 기준";
  if (base === "land_unit_median") return `비슷한 크기 토지(1/5~5배) ㎡당 중위${scope ? ` · 같은 ${scope}` : ""}`;
  return METHOD[base] ?? m;
}
const CONF: Record<string, string> = { high: "높음", medium: "보통", low: "낮음" };

export async function AnalysisTab({ item }: { item: WatchItem }) {
  const [vals, prevs, a] = await Promise.all([
    sql<{ as_of: string; estimate: number; low: number; high: number; method: string; confidence: string }[]>`
      select as_of::text, estimate, low, high, method, confidence from valuations where watch_item_id = ${item.id} order by as_of desc limit 1`,
    sql<{ estimate: number }[]>`
      select estimate from valuations where watch_item_id = ${item.id} and as_of <= current_date - 80 order by as_of desc limit 1`,
    latestAnalysis(item.user_id, item.id),
  ]);
  const v = vals[0];
  const prev = prevs[0];
  const card = a?.data.card;
  const enabled = aiEnabled();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="p-4">
        <div className="text-xs text-muted">추정 시세(AVM)</div>
        {v ? (
          <>
            <div className="tabular mt-1 text-3xl font-bold">{formatManwon(v.estimate, { short: true })}</div>
            <div className="tabular mt-1 text-sm text-muted">
              범위 {formatManwon(v.low, { short: true })} ~ {formatManwon(v.high, { short: true })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Stat label="신뢰도" value={CONF[v.confidence] ?? v.confidence} />
              <Stat label="3개월 전 대비" value={prev ? formatPct(v.estimate / prev.estimate - 1) : "-"} />
            </div>
            <p className="mt-3 text-xs text-muted">
              방법: {methodLabel(v.method)} · 기준 {formatDate(v.as_of)}. 참고용 추정치이며 감정평가가 아닙니다.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">ETL avm 단계에서 매일 계산됩니다.</p>
        )}
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          title="AI 분석 카드"
          sub={a ? `${formatDate(a.created_at, "long")} 생성 · ${a.model ?? ""}` : "데이터(시세·거래·입지·뉴스·지표)만 근거로 작성"}
          action={<AnalyzeButton itemId={item.id} enabled={enabled} hasCard={Boolean(card)} />}
        />
        {!enabled ? (
          <div className="px-4 pb-4"><Notice tone="warn">ANTHROPIC_API_KEY 를 설정하면 분석 카드를 만들 수 있습니다.</Notice></div>
        ) : null}
        {card ? (
          <div className="space-y-4 px-4 pb-4 text-sm">
            <p className="text-[15px] font-medium">{card.one_liner}</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <List title="강점" icon={<Check size={14} className="text-ok" />} items={card.strengths} />
              <List title="리스크" icon={<CircleAlert size={14} className="text-warn" />} items={card.risks} />
            </div>
            {card.factors.length ? (
              <div>
                <div className="mb-1 font-semibold">가치 요인</div>
                <ul className="space-y-1">
                  {card.factors.map((f, i) => (
                    <li key={i} className="flex gap-2">
                      {f.direction === "positive" ? <TrendingUp size={15} className="mt-0.5 shrink-0 text-up" /> : f.direction === "negative" ? <TrendingDown size={15} className="mt-0.5 shrink-0 text-down" /> : <Minus size={15} className="mt-0.5 shrink-0 text-muted" />}
                      <span><b>{f.factor}</b> — {f.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <List title="직접 확인할 것" icon={<ListChecks size={14} className="text-accent" />} items={card.checklist} />
            {card.data_gaps.length ? <p className="text-xs text-muted">부족한 데이터: {card.data_gaps.join(", ")}</p> : null}
            <p className="text-xs text-muted">투자 권유가 아닌 데이터 요약입니다. <Link href="/ai" className="text-accent">AI에게 더 묻기 →</Link></p>
          </div>
        ) : enabled ? (
          <EmptyState title="아직 분석 카드가 없습니다" desc="‘분석 생성’을 누르면 이 부동산의 데이터로 강점·리스크·체크리스트를 정리합니다." />
        ) : null}
      </Card>
    </div>
  );
}

function List({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) {
  return (
    <div>
      <div className="mb-1 font-semibold">{title}</div>
      <ul className="space-y-1">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
