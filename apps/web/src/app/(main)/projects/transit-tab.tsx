import Link from "next/link";
import { Badge, Card, CardHeader, Change, EmptyState } from "@/components/ui";
import type { AreaUnit } from "@/lib/format";
import { formatManwon, fromPerPyeong, unitPriceLabel } from "@/lib/format";
import { type TransitStation, transitStations } from "@/lib/queries/projects";
import { deleteProjectAction } from "./actions";
import { ProjectForm } from "./project-form";
import { Chip, formatDist } from "./zone-parts";

const STATUS_TONE: Record<string, "accent" | "neutral" | "warn" | "ok"> = { 개통: "neutral", 개통예정: "ok", 착공: "accent", 설계: "warn", 예타: "warn", 계획: "warn" };

/**
 * 교통 호재: 노선별 계획·착공·개통 역. 역 500m 아파트(수집된 지역)와 최근 평당가, 내 관심 부동산까지 거리,
 * 개통한 역은 반경 1km 단지 평당가의 개통 전후 12개월 변화(시군구 지수와 비교).
 */
export async function TransitTab({ uid, isAdmin, status, unit, href }: {
  uid: string;
  isAdmin: boolean;
  status: "planned" | "opened" | null;
  unit: AreaUnit;
  href: (patch: Record<string, string | null>) => string;
}) {
  const all = await transitStations(uid);
  const rows = all.filter((s) => (status === "opened" ? s.status === "개통" : status === "planned" ? s.status !== "개통" : true));
  const lines = new Map<string, TransitStation[]>();
  for (const s of rows) {
    const k = s.line_name ?? "기타";
    lines.set(k, [...(lines.get(k) ?? []), s]);
  }
  const mineNear = all.filter((s) => s.near_m !== null && s.near_m <= 2000 && s.status !== "개통");

  return (
    <div className="space-y-4">
      {mineNear.length ? (
        <Card>
          <CardHeader title="내 관심 부동산 2km 안 계획·착공 역" />
          <ul className="divide-y divide-border px-4 pb-2 text-sm">
            {mineNear.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-2">
                <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>{s.status}</Badge>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 text-xs text-muted">{s.near_label} {formatDist(s.near_m)}{s.months_left ? ` · ${s.months_left}개월 후` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card>
        <div className="-mx-0 flex gap-1.5 overflow-x-auto p-4 pb-2">
          <Chip href={href({ status: null })} active={!status}>전체 {all.length}</Chip>
          <Chip href={href({ status: "planned" })} active={status === "planned"}>계획·착공 {all.filter((s) => s.status !== "개통").length}</Chip>
          <Chip href={href({ status: "opened" })} active={status === "opened"}>최근 개통 {all.filter((s) => s.status === "개통").length}</Chip>
        </div>
        {lines.size ? (
          <div className="divide-y divide-border">
            {[...lines.entries()].map(([line, stations]) => {
              const head = stations[0];
              return (
                <section key={line} className="px-4 py-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <b>{line}</b>
                    <Badge tone={STATUS_TONE[head.status] ?? "neutral"}>{head.status}</Badge>
                    <span className="text-xs text-muted">
                      {head.status === "개통" && head.expected_open ? `${head.expected_open.slice(0, 7)} 개통` : head.expected_open ? `${head.expected_open.slice(0, 4)}년 목표` : "목표 미정"}
                      {head.months_left ? ` · ${head.months_left}개월 후` : ""}
                    </span>
                  </div>
                  <ul className="text-sm">
                    {stations.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1">
                        <span className="min-w-0 flex-1 truncate">
                          {s.name.replace(`${line} `, "")}
                          {s.precision === "dong" ? <span className="ml-1 text-[0.75rem] text-warn">위치 대략</span> : null}
                          {s.status !== head.status ? <Badge tone={STATUS_TONE[s.status] ?? "neutral"} className="ml-1">{s.status}</Badge> : null}
                        </span>
                        <span className="shrink-0 text-xs text-muted">
                          {s.complexes ? `500m 아파트 ${s.complexes} · ${s.ppy ? formatManwon(fromPerPyeong(s.ppy, unit), { short: true }) : "-"}` : "주변 단지 미수집"}
                        </span>
                        {s.effect ? (
                          <span className="shrink-0 text-xs">개통 전후 <Change value={s.effect.complex} /> <span className="text-muted">지역 <Change value={s.effect.region} /></span></span>
                        ) : null}
                        {s.near_label && s.near_m !== null ? <span className="shrink-0 text-xs text-accent">{s.near_label} {formatDist(s.near_m)}</span> : null}
                        {s.lng !== null ? <Link href={`/map?at=${s.lng},${s.lat}`} className="shrink-0 text-xs text-accent">지도</Link> : null}
                        {isAdmin ? (
                          <form action={deleteProjectAction}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="type" value="infra" />
                            <button className="text-[0.75rem] text-up">삭제</button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="철도 사업 정보를 준비하고 있어요"
            desc={isAdmin ? "매일 ETL 의 rail 단계가 계획·착공·최근 개통 노선 시드를 넣습니다(uv run myrealty rail-seed)." : "GTX·신설 노선의 역과 개통 일정을 매일 아침 자동으로 정리합니다."}
          />
        )}
        <p className="px-4 pb-4 text-[0.75rem] leading-relaxed text-muted">
          노선·개통 목표는 국가철도망 구축계획·사업자 발표를 정리한 참고 자료로, 일정은 자주 바뀝니다. 역 위치는 브이월드 역 정보이고 신설역은 법정동 중심(대략)입니다.
          {unitPriceLabel(unit)}는 수집된 지역 아파트의 최근 1년 실거래 중위, 개통 전후 변화는 반경 1km 단지(거래 6건 이상)만 계산합니다.
        </p>
      </Card>
      {isAdmin ? (
        <details className="card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">직접 등록 (관리자)</summary>
          <ProjectForm defaultType="infra" />
        </details>
      ) : null}
    </div>
  );
}
