import { Card, CardHeader, Stat } from "@/components/ui";
import { NOTIFICATION_LABELS } from "@/components/feed/notification-row";
import type { UsageStats } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { GROUP_TAGS } from "@/lib/property";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

function duration(min: number | null) {
  if (min === null) return "-";
  if (min < 60) return `${Math.max(1, Math.round(min))}분`;
  if (min < 1440) return `${Math.round(min / 60)}시간`;
  return `${Math.round(min / 1440)}일`;
}

/** 개요 › 이용 지표: 활성 사용자, 새 사용자의 첫 경험(관심 등록·재방문·가입), 알림 반응, 기능 사용 */
export function UsageCards({ u }: { u: UsageStats }) {
  const c = u.cohort;
  const n = u.notifications;
  const maxWeek = Math.max(1, ...u.weeks.map((w) => Math.max(w.newUsers, w.active)));
  return (
    <>
      <Card>
        <CardHeader
          title="이용 지표"
          sub={`활성은 하루 단위 접속 기록 기준(게스트 포함)${u.since ? ` · ${formatDate(u.since)}부터 기록` : " · 아직 기록 없음"}. 새 사용자는 최근 60일에 생긴 게스트·회원`}
        />
        <div className="grid grid-cols-2 gap-4 px-4 pb-4 md:grid-cols-5">
          <Stat label="활성 사용자" value={`${u.wau}명`} sub={<span className="text-muted">7일 · 오늘 {u.dau} · 30일 {u.mau}</span>} />
          <Stat label="관심 부동산 등록률" value={pct(c.withItem, c.users)} sub={<span className="text-muted">새 사용자 {c.users}명 중 {c.withItem}명</span>} />
          <Stat label="첫 등록까지" value={duration(c.minutesToFirstItem)} sub={<span className="text-muted">사용자가 생긴 뒤 중위</span>} />
          <Stat label="7일 뒤 재방문" value={pct(c.d7Returned, c.d7Eligible)} sub={<span className="text-muted">생긴 지 7일 넘은 {c.d7Eligible}명 중 {c.d7Returned}명</span>} />
          <Stat label="회원 전환" value={pct(c.members, c.users)} sub={<span className="text-muted">이메일 가입 {c.members}명</span>} />
        </div>
        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 flex items-center gap-3 text-xs text-muted">
            <span>주별(최근 8주)</span>
            <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--series-1)" }} />새 사용자</span>
            <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--series-2)" }} />활성</span>
          </div>
          <div className="flex h-24 items-end gap-2" role="img" aria-label="주별 새 사용자와 활성 사용자">
            {u.weeks.map((w) => (
              <div key={w.week} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <div className="flex h-full items-end justify-center gap-[2px]">
                  {[
                    [w.newUsers, "var(--series-1)"],
                    [w.active, "var(--series-2)"],
                  ].map(([v, color], i) => (
                    <div key={i} className="flex h-full w-1/2 max-w-4 flex-col justify-end" title={`${w.week} 주 · ${i ? "활성" : "새 사용자"} ${v}명`}>
                      {v ? <span className="tabular text-center text-[0.75rem] text-muted">{v}</span> : null}
                      <div className="rounded-t-sm" style={{ height: `${((v as number) / maxWeek) * 75}%`, minHeight: v ? 3 : 1, background: v ? (color as string) : "var(--chart-grid)" }} />
                    </div>
                  ))}
                </div>
                <span className="mt-1 text-center text-[0.75rem] text-muted">{w.week}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="알림 반응(30일)" sub="열람 = 사용자가 그 알림(앱·푸시)을 직접 눌러 연 것. 읽음은 '모두 읽음'도 포함" />
          <div className="grid grid-cols-3 gap-4 px-4 pb-3">
            <Stat label="보낸 알림" value={n.total.toLocaleString()} sub={<span className="text-muted">푸시 {n.pushed} · 메일 {n.emailed}</span>} />
            <Stat label="읽음" value={pct(n.read, n.total)} />
            <Stat label="열람" value={pct(n.opened, n.total)} />
          </div>
          {u.byKind.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-border text-left text-xs text-muted">
                  <th className="px-4 py-1.5 font-medium">종류</th>
                  <th className="px-2 py-1.5 text-right font-medium">건수</th>
                  <th className="px-4 py-1.5 font-medium">열람률</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {u.byKind.map((k) => (
                  <tr key={k.kind} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-1.5">{NOTIFICATION_LABELS[k.kind] ?? k.kind}</td>
                    <td className="px-2 py-1.5 text-right">{k.total}</td>
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-surface-2">
                          <div className="h-1.5 rounded-full bg-accent" style={{ width: `${k.total ? (k.opened / k.total) * 100 : 0}%` }} />
                        </div>
                        <span className="w-9 text-right text-xs">{pct(k.opened, k.total)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 pb-4 text-sm text-muted">최근 30일 알림이 없습니다.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="기능 사용" />
          <dl className="grid grid-cols-2 gap-4 px-4 pb-3 text-sm">
            <Stat label="내 자금 입력한 사용자" value={`${u.features.finance}명`} sub={<span className="text-muted">자금 계획 계산에 사용</span>} />
            <Stat label="지역 데이터 요청(30일)" value={`${u.features.regionRequests}건`} sub={<span className="text-muted">수집 지역 탭에서 관리</span>} />
          </dl>
          <div className="border-t border-border px-4 py-3">
            <div className="mb-2 text-xs text-muted">관심 부동산 그룹</div>
            <ul className="space-y-1.5 text-sm">
              {Object.entries(GROUP_TAGS).map(([k, label]) => {
                const v = u.features.groups[k] ?? 0;
                const total = Object.values(u.features.groups).reduce((a, b) => a + b, 0);
                return (
                  <li key={k} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-muted">{label}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-surface-2">
                      <div className="h-1.5 rounded-full" style={{ width: `${total ? (v / total) * 100 : 0}%`, background: "var(--series-1)" }} />
                    </div>
                    <span className="tabular w-10 text-right">{v}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}
