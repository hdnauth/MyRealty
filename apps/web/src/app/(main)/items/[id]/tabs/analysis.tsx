import { Check, CircleAlert, ListChecks, Minus, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { latestAnalysis } from "@/lib/ai/analysis";
import { AiReportButton } from "@/components/ai/report-button";
import { AiSetupNotice, AiSignupNotice } from "@/components/ai/setup-notice";
import { getUser } from "@/lib/auth/session";
import { aiStatus } from "@/lib/ai/client";
import { formatDate } from "@/lib/format";
import type { WatchItem } from "@/lib/queries/items";
import { AnalyzeButton } from "./analyze-button";

/** AI 분석 카드(요약 탭 아래): 데이터만 근거로 강점·리스크·확인할 것을 정리 */
export async function AiCard({ item }: { item: WatchItem }) {
  const [a, ai, viewer] = await Promise.all([latestAnalysis(item.user_id, item.id), aiStatus(item.user_id), getUser()]);
  const member = Boolean(viewer && !viewer.isGuest);
  const card = a?.data.card;
  const enabled = ai.enabled && member;

  return (
    <Card id="ai" className="scroll-mt-20 lg:col-span-3">
      <CardHeader
        title="AI 분석"
        sub={a ? `${formatDate(a.created_at, "long")} 생성 · ${a.model ?? ""}` : "시세·거래·입지·뉴스·지표 데이터만 근거로 강점·리스크·확인할 것을 정리합니다"}
        action={<AnalyzeButton itemId={item.id} enabled={enabled} hasCard={Boolean(card)} />}
      />
      {!member ? (
        <div className="px-4 pb-4"><AiSignupNotice next={`/items/${item.id}#ai`} /></div>
      ) : !enabled ? (
        <div className="px-4 pb-4"><AiSetupNotice problem={ai.problem} /></div>
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
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted">투자 권유가 아닌 데이터 요약입니다. <Link href="/ai" className="text-accent">AI에게 더 묻기 →</Link></p>
            <AiReportButton surface="report" refId={`item:${item.id}`} excerpt={JSON.stringify(card)} />
          </div>
        </div>
      ) : enabled ? (
        <EmptyState title="아직 분석 카드가 없습니다" desc="‘분석 생성’을 누르면 이 부동산의 데이터로 강점·리스크·체크리스트를 정리합니다." />
      ) : null}
    </Card>
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
