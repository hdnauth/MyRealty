import Link from "next/link";
import { notFound } from "next/navigation";
import { Bell, BellOff, Building2, ExternalLink, MapPin, MessagesSquare, Search, X } from "lucide-react";
import { Badge, Card, CardHeader, Change, EmptyState, Input, LinkButton, Stat } from "@/components/ui";
import type { AreaUnit } from "@/lib/format";
import { formatDate, formatManwon, fromPerPyeong, timeAgo, unitPriceLabel } from "@/lib/format";
import { GEO_LABEL, ZONE_PHASES, shortSido, zonePhase, zoneSource } from "@/lib/projects";
import {
  type ZoneDetail,
  type ZoneFilter,
  NEAR_M,
  listZones,
  myItemProjects,
  recentStageChanges,
  stagePremium,
  zoneDetail,
  zoneFacets,
  zoneStageCounts,
} from "@/lib/queries/projects";
import { stageGuide } from "@/lib/queries/special";
import { deleteProjectAction, toggleZoneFollowAction } from "./actions";
import { Chip, StageBar, StageDistribution, formatDist } from "./zone-parts";

const PAGE = 60;
const APPROX = new Set(["place", "dong"]);

export async function ZonesTab({ uid, isAdmin, f, limit, zoneId, unit, href }: {
  uid: string;
  isAdmin: boolean;
  f: ZoneFilter;
  limit: number;
  zoneId: number | null;
  unit: AreaUnit;
  href: (patch: Record<string, string | null>) => string;
}) {
  const [list, counts, facets, changes, mine, detail, premium] = await Promise.all([
    listZones(uid, f, limit),
    zoneStageCounts(uid, f),
    zoneFacets(f.sido),
    recentStageChanges(f),
    myItemProjects(uid),
    zoneId ? zoneDetail(uid, zoneId) : null,
    stagePremium(f.sido),
  ]);
  if (zoneId && !detail) notFound();
  const phaseCount = (key: string) => {
    const p = ZONE_PHASES.find((x) => x.key === key)!;
    return counts.filter((c) => c.stage_order !== null && c.stage_order >= p.from && c.stage_order <= p.to).reduce((s, c) => s + c.n, 0);
  };
  const activeTotal = counts.filter((c) => c.stage_order !== 9).reduce((s, c) => s + c.n, 0);
  const nearItem = f.near ? mine.find((m) => m.id === f.near) : null;
  const filtered = Boolean(f.sido || f.gu || f.kind || f.q || f.near || f.followed);
  const empty = facets.kinds.length === 0 && list.total === 0 && !filtered;

  return (
    <>
      {detail ? <ZoneDetailCard d={detail} unit={unit} closeHref={href({ zone: null })} isAdmin={isAdmin} /> : null}

      {empty ? (
        <Card>
          <EmptyState
            title="정비구역 정보를 준비하고 있어요"
            desc={
              isAdmin ? (
                <>매일 ETL 의 <code>zones</code> 단계가 서울·경기·부산·인천 정비사업 시스템과 국토부 전국 통합 데이터에서 구역·단계를 모읍니다. 바로 받으려면 <code>uv run myrealty zones</code>.</>
              ) : (
                "전국 재개발·재건축 구역과 진행 단계를 매일 아침 자동으로 모읍니다. 준비되면 이 화면에 나타납니다."
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-4 lg:grid lg:grid-cols-[1fr_18rem] lg:gap-4 lg:space-y-0">
          <div className="min-w-0 space-y-4">
            {mine.some((m) => m.zones > 0 || m.infra) ? (
              <Card>
                <CardHeader title="내 관심 부동산 주변" sub={`정비구역 반경 ${NEAR_M / 1000}km(진행 중) · 계획 철도·도로 3km`} />
                <ul className="divide-y divide-border px-4 pb-2 text-sm">
                  {mine.filter((m) => m.zones > 0 || m.infra).map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <Link href={`/items/${m.id}?tab=location`} className="min-w-0 max-w-[12rem] truncate font-medium">{m.label}</Link>
                      {m.zones > 0 ? (
                        <Link href={href({ near: m.id, phase: null, sido: null, gu: null })} scroll={false} className={f.near === m.id ? "font-semibold text-accent" : "text-accent"}>
                          정비구역 {m.zones}곳{m.advanced ? ` · 인가 이후 ${m.advanced}` : ""}
                        </Link>
                      ) : null}
                      {m.nearest ? <span className="truncate text-xs text-muted">가장 가까운 {m.nearest.name}({m.nearest.stage ?? "단계 미상"}) {formatDist(m.nearest.dist)}</span> : null}
                      {m.infra ? <span className="truncate text-xs text-muted">🚉 {m.infra.name} {m.infra.status}{m.infra.expected_open ? ` ${m.infra.expected_open.slice(0, 4)}` : ""} · {formatDist(m.infra.dist)}</span> : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card>
              <div className="space-y-2 p-4">
                <form action="/projects" className="flex gap-2">
                  {Object.entries({ sido: f.sido, gu: f.gu, kind: f.kind, phase: f.phase, near: f.near, follow: f.followed ? "1" : null, sort: f.sort === "recent" ? null : f.sort })
                    .map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
                  <Input name="q" defaultValue={f.q ?? ""} placeholder="구역·단지명, 동 이름 (예: 개포, 북변, 감만)" className="h-10" />
                  <button className="inline-flex h-10 shrink-0 items-center gap-1 rounded-lg bg-accent px-3 text-sm font-medium text-white" aria-label="검색"><Search size={15} /></button>
                </form>
                <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
                  <Chip href={href({ phase: null })} active={!f.phase}>진행 중 {activeTotal.toLocaleString()}</Chip>
                  {ZONE_PHASES.map((p) => (
                    <Chip key={p.key} href={href({ phase: p.key })} active={f.phase === p.key}>{p.label} {phaseCount(p.key).toLocaleString()}</Chip>
                  ))}
                  <Chip href={href({ phase: "all" })} active={f.phase === "all"}>전체</Chip>
                  <Chip href={href({ follow: f.followed ? null : "1" })} active={f.followed}><Bell size={12} className="mr-0.5 inline" />팔로우</Chip>
                </div>
                <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
                  <Chip href={href({ sido: null, gu: null })} active={!f.sido}>전국</Chip>
                  {facets.sidos.map((s) => <Chip key={s.name} href={href({ sido: s.name, gu: null })} active={f.sido === s.name}>{shortSido(s.name)} {s.n}</Chip>)}
                </div>
                {f.sido && facets.gus.length ? (
                  <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
                    <Chip href={href({ gu: null })} active={!f.gu}>{shortSido(f.sido)} 전체</Chip>
                    {facets.gus.map((g) => <Chip key={g.name} href={href({ gu: g.name })} active={f.gu === g.name}>{g.name} {g.n}</Chip>)}
                  </div>
                ) : null}
                <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
                  <Chip href={href({ kind: null })} active={!f.kind}>모든 유형</Chip>
                  {facets.kinds.map((k) => <Chip key={k.kind} href={href({ kind: k.kind })} active={f.kind === k.kind}>{k.kind} {k.n}</Chip>)}
                </div>
                {f.near || f.q ? (
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {nearItem ? <Link href={href({ near: null })} scroll={false} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-1 text-accent">{nearItem.label} {NEAR_M / 1000}km 안 <X size={12} /></Link> : null}
                    {f.q ? <Link href={href({ q: null })} scroll={false} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-1 text-accent">“{f.q}” <X size={12} /></Link> : null}
                  </div>
                ) : null}
              </div>
            </Card>

            <Card>
              <CardHeader
                title={`정비구역 ${list.total.toLocaleString()}곳`}
                sub={f.phase === "all" ? "완료 포함" : f.phase ? ZONE_PHASES.find((p) => p.key === f.phase)!.sub : "진행 중(준공·해산·청산·해제 제외)"}
                action={
                  <span className="flex flex-wrap justify-end gap-x-2 text-xs">
                    {(["recent", "stage", "households", "near"] as const).map((s) => (
                      <Link key={s} href={href({ sort: s === "recent" ? null : s })} scroll={false} className={f.sort === s ? "font-semibold text-accent" : "text-muted"}>
                        {s === "recent" ? "최근 변화" : s === "stage" ? "진척 순" : s === "households" ? "세대수" : "내 부동산 가까운"}
                      </Link>
                    ))}
                  </span>
                }
              />
              {list.rows.length ? (
                <ul className="divide-y divide-border">
                  {list.rows.map((z) => (
                    <li key={z.id} className={zoneId === z.id ? "bg-accent-soft/40" : undefined}>
                      <Link href={href({ zone: String(z.id) })} className="block px-4 py-2.5 hover:bg-surface-2/60">
                        <div className="flex items-center gap-2">
                          <Badge tone={zonePhase(z.stage_order) === "done" ? "neutral" : "accent"}>{z.kind}</Badge>
                          <span className="min-w-0 flex-1 truncate font-medium">{z.name}</span>
                          {z.followed ? <Bell size={13} className="shrink-0 text-accent" aria-label="팔로우" /> : null}
                          <span className="shrink-0 text-xs">{z.stage ?? "단계 미상"}</span>
                        </div>
                        <StageBar order={z.stage_order} className="mt-1.5" />
                        <div className="mt-1 flex gap-2 text-[0.75rem] text-muted">
                          <span className="truncate">
                            {f.sido ? "" : `${shortSido(z.sido)} `}{z.gu ?? ""}
                            {z.households_plan ? ` · ${z.households_plan.toLocaleString()}세대` : ""}
                            {z.lng === null ? " · 위치 미상" : z.geo && APPROX.has(z.geo) ? " · 위치 대략" : ""}
                          </span>
                          {z.changed_at ? <span className="shrink-0 text-accent">단계 변경 {timeAgo(z.changed_at)}</span> : null}
                          {z.near_label && z.near_m !== null ? <span className="ml-auto shrink-0">{z.near_label} {formatDist(z.near_m)}</span> : null}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="조건에 맞는 구역이 없습니다" action={<Link href="/projects" className="text-accent">조건 지우기</Link>} />
              )}
              {list.total > list.rows.length ? (
                <div className="border-t border-border p-3 text-center text-sm">
                  <Link href={href({ limit: String(limit + PAGE * 2) })} scroll={false} className="text-accent">더 보기 ({list.rows.length}/{list.total.toLocaleString()})</Link>
                </div>
              ) : null}
            </Card>
          </div>

          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader title="단계 분포" sub="막대를 누르면 그 단계 묶음만" />
              <StageDistribution counts={counts} activePhase={f.phase} hrefFor={(phase) => href({ phase: f.phase === phase ? null : phase })} />
            </Card>
            {premium.length ? (
              <Card>
                <CardHeader title="단계별 가격 프리미엄" sub={`구역 단지 vs 같은 시군구 아파트 중위(최근 1년 ${unitPriceLabel(unit)})`} />
                <ul className="space-y-1.5 px-4 pb-3 text-sm">
                  {premium.map((p) => (
                    <li key={p.phase} className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-xs text-muted">{ZONE_PHASES.find((x) => x.key === p.phase)?.label}</span>
                      <span className="tabular min-w-0 flex-1 truncate">{p.ppy ? formatManwon(fromPerPyeong(p.ppy, unit), { short: true }) : "-"}</span>
                      <Change value={p.ppy && p.base ? p.ppy / p.base - 1 : null} />
                      <span className="w-10 shrink-0 text-right text-[0.75rem] text-muted">{p.complexes}단지</span>
                    </li>
                  ))}
                </ul>
                <p className="px-4 pb-3 text-[0.75rem] text-muted">구역에 연결된 단지(경계 안·같은 이름)의 실거래만. 지역·연식 차이가 섞인 단순 비교라 참고용입니다.</p>
              </Card>
            ) : null}
            <Card>
              <CardHeader title="최근 단계 변화" sub="매일 수집 때 바뀐 곳" />
              {changes.length ? (
                <ul className="divide-y divide-border px-4 pb-2 text-sm">
                  {changes.map((c) => (
                    <li key={c.id} className="py-2">
                      <Link href={href({ zone: String(c.zone_id) })} className="block">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="text-xs text-muted">{c.prev_stage ?? "?"} → <b className="text-text">{c.stage ?? "?"}</b> · {timeAgo(c.changed_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 pb-4 text-xs text-muted">아직 기록된 변화가 없습니다. 두 번째 수집부터 단계가 바뀐 구역이 여기에 쌓입니다.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function ZoneDetailCard({ d, unit, closeHref, isAdmin }: { d: ZoneDetail; unit: AreaUnit; closeHref: string; isAdmin: boolean }) {
  const extra = d.households_plan && d.households_now ? d.households_plan - d.households_now : null;
  const src = zoneSource(d.source);
  const ex = d.extra as { owners?: string; members?: string; method?: string; zoning?: string; executor?: string };
  return (
    <Card className="mb-4">
      <CardHeader
        title={<span className="flex items-center gap-2"><Badge tone="accent">{d.kind}</Badge>{d.name}</span>}
        sub={[d.full_name && d.full_name !== d.name ? d.full_name : null, [shortSido(d.sido), d.gu].filter(Boolean).join(" "), d.address].filter(Boolean).join(" · ")}
        action={<Link href={closeHref} scroll={false} aria-label="닫기" className="text-muted"><X size={18} /></Link>}
      />
      <div className="px-4 pb-3">
        <StageBar order={d.stage_order} labels />
        <p className="mt-2 text-xs leading-relaxed">
          {zonePhase(d.stage_order) === "done" ? (d.stage?.includes("해제") ? "정비구역이 해제된 곳입니다." : "사업이 끝난(준공·해산·청산) 구역입니다.") : stageGuide(d.stage_order)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-border px-4 py-3 sm:grid-cols-4">
        <Stat label="현재 단계" value={d.stage ?? "-"} sub={<span className="text-muted">{d.stage_date ? `${formatDate(d.stage_date)} 기준` : "변경일 미상"}</span>} />
        <Stat
          label="공급 예정 세대수"
          value={d.households_plan ? `${d.households_plan.toLocaleString()}세대` : "-"}
          sub={<span className="text-muted">{extra !== null ? `기존 대비 +${extra.toLocaleString()}` : d.molit ? "국토부 통합 데이터" : "조합 공개자료 확인"}</span>}
        />
        <Stat label="내 관심 부동산" value={d.near_m !== null ? formatDist(d.near_m) : "-"} sub={<span className="text-muted">{d.near_label ?? "3km 안 없음"}</span>} />
        <Stat
          label="구역 면적"
          value={d.area_m2 ? `${Math.round(d.area_m2).toLocaleString()}㎡` : "-"}
          sub={<span className="text-muted">{d.area_m2 ? `${Math.round(d.area_m2 / 3.305785).toLocaleString()}평` : "경계 자료 없음"}</span>}
        />
        {ex.executor || d.molit?.executor ? <Stat label="사업시행자" value={ex.executor ?? d.molit?.executor} /> : null}
        {ex.owners ? <Stat label="토지등소유자" value={`${Number(ex.owners).toLocaleString()}명`} sub={ex.members ? <span className="text-muted">조합원 {Number(ex.members).toLocaleString()}명</span> : null} /> : null}
        {ex.zoning ? <Stat label="용도지역" value={ex.zoning} sub={ex.method ? <span className="text-muted">{ex.method}</span> : null} /> : null}
        {d.molit?.stage && d.molit.stage.replace(/^\d+\)/, "") !== d.stage ? <Stat label="국토부 자료 단계" value={d.molit.stage.replace(/^\d+\)/, "")} sub={<span className="text-muted">연 1회 갱신</span>} /> : null}
      </div>
      {d.complexes.length ? (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-1 text-xs font-medium text-muted">
            {d.complexes.some((c) => c.how) ? "구역 단지" : "구역 주변 300m 단지"} (최근 1년 매매 {unitPriceLabel(unit)})
          </p>
          <ul className="text-sm">
            {d.complexes.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1">
                <Building2 size={13} className="shrink-0 text-muted" />
                <Link href={`/complexes/${c.id}`} className="min-w-0 flex-1 truncate text-accent">{c.name}</Link>
                <span className="shrink-0 text-xs text-muted">{c.build_year ? `${c.build_year}년` : ""}{c.households ? ` · ${c.households.toLocaleString()}세대` : ""}{c.how ? "" : ` · ${formatDist(c.dist)}`}</span>
                <span className="tabular w-20 shrink-0 text-right">{c.ppy ? formatManwon(fromPerPyeong(c.ppy, unit), { short: true }) : "-"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.effects.length ? (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-1 text-xs font-medium text-muted">단계 변화 전후 1년 가격 (구역 단지 vs 시군구 지수)</p>
          <ul className="space-y-1 text-sm">
            {d.effects.map((e) => (
              <li key={e.changed_on} className="flex flex-wrap items-center gap-x-3">
                <span className="min-w-0 flex-1">{e.stage ?? "단계"} <span className="text-xs text-muted">{formatDate(e.changed_on)} · 거래 {e.n_before}→{e.n_after}건</span></span>
                <span className="text-xs">구역 <Change value={e.complex_change} /></span>
                <span className="text-xs">지역 <Change value={e.region_change} /></span>
                <span className="text-xs font-semibold">초과 <Change value={e.excess} /></span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {d.history.length ? (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-1 text-xs font-medium text-muted">단계 변경 기록</p>
          <ul className="space-y-0.5 text-xs">
            {d.history.map((h, i) => (
              <li key={i}>{formatDate(h.changed_at)} · {h.prev_stage ?? "?"} → <b>{h.stage ?? "?"}</b></li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <form action={toggleZoneFollowAction}>
          <input type="hidden" name="zone" value={d.id} />
          <input type="hidden" name="on" value={d.followed ? "0" : "1"} />
          <button className={`inline-flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-medium ${d.followed ? "border border-border bg-surface-2" : "bg-accent text-white"}`}>
            {d.followed ? <><BellOff size={13} />팔로우 중</> : <><Bell size={13} />팔로우(단계 알림)</>}
          </button>
        </form>
        {d.lng !== null ? <LinkButton href={`/map?at=${d.lng},${d.lat}`} variant="secondary" className="h-8 px-3 text-xs"><MapPin size={13} />지도</LinkButton> : null}
        {d.sgg_cd ? <LinkButton href={`/community?sgg=${d.sgg_cd}`} variant="secondary" className="h-8 px-3 text-xs"><MessagesSquare size={13} />동네 이야기</LinkButton> : null}
        {d.url ? (
          <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface-2 px-3 text-xs">
            <ExternalLink size={13} />{d.source === "seoul" ? "정보몽땅 사업장" : "출처 보기"}
          </a>
        ) : null}
        {d.map_code ? (
          <a href={`https://urban.seoul.go.kr/view/map/mapPopup.html?recordCode=${encodeURIComponent(d.map_code)}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface-2 px-3 text-xs">
            <ExternalLink size={13} />구역 경계(서울 도시계획)
          </a>
        ) : null}
        {isAdmin ? (
          <form action={deleteProjectAction} className="ml-auto">
            <input type="hidden" name="id" value={d.id} />
            <input type="hidden" name="type" value="zone" />
            <button className="h-8 text-xs text-up">삭제</button>
          </form>
        ) : null}
      </div>
      <p className="px-4 pb-3 text-[0.75rem] text-muted">
        출처: {src.url ? <a href={src.url} target="_blank" rel="noreferrer" className="underline">{src.label}</a> : src.label}
        {d.molit && d.source !== "molit" ? " · 세대수·시행자: 국토교통부 전국 도시정비사업 통합 데이터" : ""}. 위치: {d.lng === null ? "미상" : GEO_LABEL[d.geo ?? ""] ?? "출처 좌표"}
        {d.followers ? ` · 팔로우 ${d.followers}명` : ""}. 권리가액·분담금은 조합 공지를 확인하세요.
      </p>
    </Card>
  );
}
