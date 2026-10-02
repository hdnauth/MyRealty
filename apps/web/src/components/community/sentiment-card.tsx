import Link from "next/link";
import { LineSeriesChart } from "@/components/charts/series-chart";
import { Card, CardHeader } from "@/components/ui";
import { outlookSentiment } from "@/lib/community/queries";

/** 지표 화면: 동네 이야기 '1년 뒤 가격 전망' 투표를 모은 커뮤니티 심리(-100 비관 ~ +100 낙관) */
export async function SentimentCard({ sgg, region }: { sgg: string; region: string | null }) {
  const rows = await outlookSentiment(sgg);
  const last = rows.at(-1);
  const newPoll = `/community/new?sgg=${sgg}&poll=outlook&cat=opinion&title=${encodeURIComponent(`${region ?? "우리 지역"} 1년 뒤 집값, 어떻게 보세요?`)}`;
  return (
    <Card>
      <CardHeader
        title="커뮤니티 심리"
        sub={`동네 이야기 '1년 뒤 가격 전망' 투표 · ${region ?? ""} · 오른다 +100 / 비슷하다 0 / 내린다 -100 평균`}
        action={<Link href={newPoll} className="text-accent">전망 투표 열기</Link>}
      />
      {last ? (
        <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted">{last.month} · {last.votes}표</div>
            <div className={`mt-1 text-3xl font-bold ${last.score > 0 ? "text-up" : last.score < 0 ? "text-down" : ""}`}>{last.score > 0 ? "+" : ""}{last.score}</div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2" aria-label={`오른다 ${last.up}, 비슷하다 ${last.flat}, 내린다 ${last.down}`}>
              <span className="bg-up" style={{ width: `${(last.up / last.votes) * 100}%` }} />
              <span className="bg-border" style={{ width: `${(last.flat / last.votes) * 100}%` }} />
              <span className="bg-down" style={{ width: `${(last.down / last.votes) * 100}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-muted">오른다 {last.up} · 비슷하다 {last.flat} · 내린다 {last.down}</div>
            {last.votes < 10 ? <p className="mt-2 text-[11px] text-warn">표가 적어 대표성이 낮습니다(10표 미만).</p> : null}
          </div>
          <div className="sm:col-span-2">
            {rows.length >= 2 ? (
              <LineSeriesChart lines={[{ name: "커뮤니티 심리", points: rows.map((r) => [`${r.month}-01`, r.score] as [string, number]) }]} fmt="num" yMin={-100} yMax={100} height={140} />
            ) : (
              <p className="pt-2 text-xs text-muted">두 달 이상 모이면 추이가 보입니다. 참여한 사용자 의견일 뿐 시장 전체를 대표하지 않습니다.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="px-4 pb-4 text-sm text-muted">
          아직 이 지역 전망 투표가 없습니다. <Link href={newPoll} className="text-accent underline">투표를 열어</Link> 이웃의 생각을 모아 보세요.
        </p>
      )}
    </Card>
  );
}
