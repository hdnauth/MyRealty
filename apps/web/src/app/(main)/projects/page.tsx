import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { LinkButton, PageHeader, Tabs } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { getUser, NO_USER } from "@/lib/auth/session";
import { THEME_TABS, type ThemeTab, ZONE_PHASES, type ZonePhase } from "@/lib/projects";
import type { ZoneFilter } from "@/lib/queries/projects";
import { ProjectForm } from "./project-form";
import { RebuildTab, type RebuildSort } from "./rebuild-tab";
import { RegulationTab } from "./regulation-tab";
import { SupplyTab } from "./supply-tab";
import { TransitTab } from "./transit-tab";
import { ZonesTab } from "./zones-tab";

export const metadata: Metadata = { title: "개발·테마" };

const PAGE = 60;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

const SUBS: Record<ThemeTab, string> = {
  zones: "서울·경기·부산·인천 등 전국 정비구역의 단계와 변화. 단계가 바뀌면 주변·팔로우한 구역을 알려 드립니다.",
  rebuild: "아직 구역 지정 전이거나 초기인 오래된 아파트 — 용적률 여유·대지지분·연식으로 사업성 재료를 봅니다.",
  transit: "GTX·신설 노선의 역과 개통 일정, 역세권 단지 시세, 최근 개통 역의 전후 가격 변화.",
  regulation: "토지거래허가구역·지구단위계획구역·정비구역에 내 부동산이 걸리는지, 지역별 허가구역 현황.",
  supply: "시군구별로 앞으로 나올 물량 — 입주 예정과 정비사업 단계별 공급 예정 세대수.",
};

export default async function ProjectsPage(props: PageProps<"/projects">) {
  // 방문자도 볼 수 있다(내 부동산·팔로우 연결만 비어 있다)
  const [viewer, sp, unit] = await Promise.all([getUser(), props.searchParams, getAreaUnit()]);
  const user = { id: viewer?.id ?? NO_USER, isAdmin: viewer?.isAdmin ?? false };
  const tabParam = one(sp.tab);
  // 예전 링크(?tab=infra)는 교통 탭으로
  const tab: ThemeTab = tabParam === "infra" ? "transit" : (THEME_TABS.find((t) => t.key === tabParam)?.key ?? "zones");

  // 현재 조건에서 일부만 바꾼 링크(탭마다 쓰는 파라미터만 남긴다)
  const keep: Record<ThemeTab, string[]> = {
    zones: ["sido", "gu", "kind", "phase", "q", "near", "follow", "sort"],
    rebuild: ["csgg", "age", "sort"],
    transit: ["status"],
    regulation: [],
    supply: [],
  };
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    if (tab !== "zones") q.set("tab", tab);
    for (const k of keep[tab]) {
      const v = k in patch ? patch[k] : one(sp[k]);
      if (v) q.set(k, v);
    }
    for (const [k, v] of Object.entries(patch)) if (!keep[tab].includes(k) && v) q.set(k, v);
    const s = q.toString();
    return s ? `/projects?${s}` : "/projects";
  };

  let body: React.ReactNode;
  if (tab === "zones") {
    const phaseParam = one(sp.phase);
    const sortParam = one(sp.sort);
    const f: ZoneFilter = {
      sido: one(sp.sido),
      gu: one(sp.gu),
      kind: one(sp.kind),
      phase: phaseParam === "all" || ZONE_PHASES.some((p) => p.key === phaseParam) ? (phaseParam as ZonePhase | "all") : null,
      q: one(sp.q),
      near: one(sp.near),
      followed: one(sp.follow) === "1",
      sort: sortParam === "stage" || sortParam === "near" || sortParam === "households" ? sortParam : "recent",
    };
    const zoneId = Number(one(sp.zone));
    body = (
      <ZonesTab
        uid={user.id}
        isAdmin={user.isAdmin}
        f={f}
        limit={Math.min(600, Math.max(PAGE, Number(one(sp.limit)) || PAGE))}
        zoneId={Number.isInteger(zoneId) && zoneId > 0 ? zoneId : null}
        unit={unit}
        href={href}
      />
    );
  } else if (tab === "rebuild") {
    const age = Number(one(sp.age));
    const sort = one(sp.sort);
    body = (
      <RebuildTab
        uid={user.id}
        sgg={one(sp.csgg)}
        age={[25, 35].includes(age) ? age : 30}
        sort={(["headroom", "share", "age", "price"].includes(sort ?? "") ? sort : "score") as RebuildSort}
        unit={unit}
        href={href}
      />
    );
  } else if (tab === "transit") {
    const status = one(sp.status);
    body = <TransitTab uid={user.id} isAdmin={user.isAdmin} status={status === "planned" || status === "opened" ? status : null} unit={unit} href={href} />;
  } else if (tab === "regulation") {
    body = <RegulationTab uid={user.id} />;
  } else {
    body = <SupplyTab uid={user.id} />;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="개발·테마"
        sub={SUBS[tab]}
        action={<LinkButton href={tab === "transit" ? "/map?layers=infra" : tab === "regulation" ? "/map?layers=permit,district_plan" : "/map?layers=zones"} variant="secondary" className="h-9 shrink-0 whitespace-nowrap px-3 text-sm"><MapPin size={14} />지도</LinkButton>}
      />
      <Tabs active={tab} items={THEME_TABS.map((t) => ({ key: t.key, label: t.label, href: t.key === "zones" ? "/projects" : `/projects?tab=${t.key}` }))} />
      {body}
      {user.isAdmin && tab === "zones" ? (
        <details className="card mt-4">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">직접 등록 (관리자)</summary>
          <p className="px-4 text-xs text-muted">자동 수집에 없는 구역·계획 노선용. 일괄 등록: <code>uv run myrealty import-geo 파일 --kind zones|infra</code></p>
          <ProjectForm />
        </details>
      ) : null}
    </div>
  );
}
