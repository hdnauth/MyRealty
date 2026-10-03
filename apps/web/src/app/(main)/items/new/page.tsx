import type { Metadata } from "next";
import type { AddressCandidate } from "@/app/api/address/route";
import { PageHeader } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { GuestNote } from "@/components/shell/member-gate";
import { getUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getComplex } from "@/lib/queries/complexes";
import { NewItemForm } from "./new-item-form";
import { isItemGroup, readFinanceProfile } from "@/lib/brief";

export const metadata: Metadata = { title: "부동산 등록" };

export default async function NewItemPage(props: PageProps<"/items/new">) {
  // 방문자도 등록할 수 있다: 저장할 때 이 기기의 게스트 계정이 만들어진다
  const [sp, user] = await Promise.all([props.searchParams, getUser()]);
  // ?complex=단지 id: 단지 상세·지도에서 '관심 등록'으로 들어오면 그 단지를 고른 상태로 연다
  const [unit, complex] = await Promise.all([getAreaUnit(), typeof sp.complex === "string" ? getComplex(Number(sp.complex)) : null]);
  const initialPick: AddressCandidate | null = complex ? complexCandidate(complex) : null;
  // ?group=owned|candidate|watch|tenant: 그룹을 미리 고른 채로 연다
  const group = isItemGroup(sp.group) ? sp.group : undefined;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="관심 부동산 등록"
        sub="주소만 넣으면 시세·비슷한 단지 비교·시장 흐름·위험 신호를 한 화면에 정리해 드려요."
      />
      {!user || user.isGuest ? <GuestNote className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted" /> : null}
      <NewItemForm
        mapKeys={{ keyId: env.ncpKeyId ?? null, vworldKey: env.vworldKey ?? null }}
        unit={unit}
        initialPick={initialPick}
        initialGroup={group}
        profile={readFinanceProfile(user?.settings)}
      />
    </div>
  );
}

function complexCandidate(c: NonNullable<Awaited<ReturnType<typeof getComplex>>>): AddressCandidate {
  const m = (c.jibun ?? "").match(/^(산\s*)?(\d+)(?:-(\d+))?$/);
  return {
    source: "local",
    roadAddr: c.road_address,
    jibunAddr: [c.sido, c.sigungu, c.umd_nm, c.jibun].filter(Boolean).join(" "),
    lawdCd: c.lawd_cd,
    sggCd: c.sgg_cd,
    sidoName: c.sido,
    sggName: c.sigungu,
    emdName: c.umd_nm,
    jibun: c.jibun,
    mountain: Boolean(m?.[1]),
    bonbun: m ? Number(m[2]) : null,
    bubun: m ? Number(m[3] ?? 0) : null,
    buildingName: c.name,
    isApartment: c.property_type === "apt",
    complexId: c.id,
    complexName: c.name,
    complexType: c.property_type,
    dongs: [],
  };
}

