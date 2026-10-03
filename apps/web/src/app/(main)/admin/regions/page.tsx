import type { Metadata } from "next";
import { Badge, Button, Card, CardHeader, Stat } from "@/components/ui";
import { regionAdmin } from "@/lib/admin";
import { formatDate, formatNumber, timeAgo } from "@/lib/format";
import { ActionForm } from "../action-form";
import { enableRegionAction, rejectRegionAction, setTargetEnabledAction } from "../actions";

export const metadata: Metadata = { title: "수집 지역" };

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "neutral" }> = {
  enabled: { label: "켜짐", tone: "ok" },
  pending: { label: "대기", tone: "warn" },
  rejected: { label: "거절", tone: "neutral" },
};

/**
 * 수집 지역: 매일 실거래를 모으는 시군구(collect_targets)와 지도 "이 지역 데이터 모으기" 요청(region_requests).
 * 켜진 지역이 REGION_TARGET_CAP 이상이면 요청은 대기로 남고 여기서 켠다. 공공 API 일일 한도를 나눠 쓰므로 지역 수에 주의.
 */
export default async function AdminRegions() {
  const { targets, pending, recent, cap, enabled } = await regionAdmin();
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
          <Stat label="켜진 수집 지역" value={`${enabled}곳`} sub={<span className={enabled >= cap ? "text-up" : "text-muted"}>자동으로 켜는 상한 {cap}곳</span>} />
          <Stat label="대기 중인 요청" value={`${pending.length}곳`} sub={<span className="text-muted">상한을 넘어 운영자 확인 필요</span>} />
          <Stat label="꺼진 지역" value={`${targets.length - enabled}곳`} sub={<span className="text-muted">모은 데이터는 남아 있음</span>} />
          <Stat label="지역 지표 계산" value={`${targets.filter((t) => t.indicators).length}곳`} sub={<span className="text-muted">아파트 거래가 충분한 곳</span>} />
        </div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          지역 하나를 처음 켜면 매매·전월세 11종 × 최근 3개월을 받은 뒤 과거로 채워 나갑니다(공공데이터 일일 한도를 다른 지역과 나눠 씀). 상한은 환경 변수 REGION_TARGET_CAP.
        </p>
      </Card>

      <Card>
        <CardHeader title="대기 중인 지역 요청" sub="시군구별로 묶었습니다. 켜면 같은 시군구의 대기 요청이 모두 처리됩니다." />
        {pending.length ? (
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {pending.map((r) => (
              <li key={r.sgg_cd} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <span className="min-w-0 flex-1">
                  <b>{r.name ?? r.sgg_cd}</b> <span className="text-xs text-muted">{r.sgg_cd} · 요청 {r.same}건 · 처음 {timeAgo(r.created_at)} · {r.email ?? "게스트(기기)"}</span>
                </span>
                <ActionForm action={enableRegionAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="sgg" value={r.sgg_cd} />
                  <Button type="submit" className="h-8 px-3 text-xs">수집 켜기</Button>
                </ActionForm>
                <ActionForm action={rejectRegionAction} className="flex flex-wrap items-center gap-2" confirm={`${r.name ?? r.sgg_cd} 요청을 거절할까요?`}>
                  <input type="hidden" name="sgg" value={r.sgg_cd} />
                  <Button type="submit" variant="secondary" className="h-8 px-3 text-xs">거절</Button>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-sm text-muted">대기 중인 요청이 없습니다.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="수집 지역" sub="관심 부동산 등록·지역 요청으로 생긴 시군구. 끄면 매일 수집에서 빠집니다." />
        <div className="overflow-x-auto pb-2">
          <table className="w-full min-w-[720px] whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">지역</th>
                <th className="px-2 py-2 text-right font-medium">관심 부동산</th>
                <th className="px-2 py-2 text-right font-medium">요청</th>
                <th className="px-2 py-2 text-right font-medium">실거래</th>
                <th className="px-2 py-2 font-medium">최근 거래</th>
                <th className="px-2 py-2 font-medium">과거 채움</th>
                <th className="px-2 py-2 font-medium">지표</th>
                <th className="px-4 py-2 text-right font-medium">수집</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {targets.map((t) => (
                <tr key={t.sgg_cd} className={`border-b border-border/60 last:border-0 ${t.enabled ? "" : "text-muted"}`}>
                  <td className="px-4 py-2">
                    <span className="font-medium">{t.name ?? t.sgg_cd}</span> <span className="text-xs text-muted">{t.sgg_cd} · {formatDate(t.created_at)}{t.auto_from ? ` · 같은 시 자동(${t.auto_from})` : ""}</span>
                  </td>
                  <td className="px-2 py-2 text-right">{t.items || "-"}</td>
                  <td className="px-2 py-2 text-right">{t.requests || "-"}</td>
                  <td className="px-2 py-2 text-right">{t.trades ? formatNumber(t.trades) : <span className="text-warn">아직 없음</span>}</td>
                  <td className="px-2 py-2">{t.last_deal ? formatDate(t.last_deal) : "-"}</td>
                  <td className="px-2 py-2">{t.backfilled_to ? `${t.backfilled_to.slice(0, 7)}까지` : "최근 3개월"} <span className="text-xs text-muted">/ {t.backfill_months}개월</span></td>
                  <td className="px-2 py-2">{t.indicators ? <Badge tone="ok">계산됨</Badge> : <Badge>없음</Badge>}</td>
                  <td className="px-4 py-2 text-right">
                    <ActionForm
                      action={setTargetEnabledAction}
                      className="inline-flex flex-col items-end gap-1"
                      confirm={t.enabled && t.items ? `관심 부동산 ${t.items}개가 있는 지역입니다. 끄면 새 거래·알림이 멈춥니다. 끌까요?` : undefined}
                    >
                      <input type="hidden" name="sgg" value={t.sgg_cd} />
                      <input type="hidden" name="enabled" value={t.enabled ? "0" : "1"} />
                      <Button type="submit" variant={t.enabled ? "secondary" : "primary"} className="h-7 px-2.5 text-xs">
                        {t.enabled ? "끄기" : "켜기"}
                      </Button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="최근 지역 요청" sub="최근 30건 · 지도에서 수집 전 지역을 보다가 요청" />
        <ul className="divide-y divide-border px-4 pb-2 text-sm">
          {recent.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">
                {r.name ?? r.sgg_cd} <span className="text-xs text-muted">· {r.email ?? "게스트(기기)"}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                {timeAgo(r.created_at)}
              </span>
            </li>
          ))}
          {!recent.length ? <li className="py-2 text-muted">아직 요청이 없습니다.</li> : null}
        </ul>
      </Card>
    </div>
  );
}
