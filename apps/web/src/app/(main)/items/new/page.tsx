import type { Metadata } from "next";
import type { AddressCandidate } from "@/app/api/address/route";
import { PageHeader } from "@/components/ui";
import { getAreaUnit } from "@/lib/area-unit";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { getComplex } from "@/lib/queries/complexes";
import { NewItemForm } from "./new-item-form";

export const metadata: Metadata = { title: "부동산 등록" };

export default async function NewItemPage(props: PageProps<"/items/new">) {
  const [sp] = await Promise.all([props.searchParams, requireUser()]);
  // ?complex=단지 id: 단지 상세·지도에서 '관심 등록'으로 들어오면 그 단지를 고른 상태로 연다
  const [unit, complex] = await Promise.all([getAreaUnit(), typeof sp.complex === "string" ? getComplex(Number(sp.complex)) : null]);
  const initialPick: AddressCandidate | null = complex ? complexCandidate(complex) : null;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="관심 부동산 등록" sub="아파트·빌라·오피스텔·단독·토지·임야·상가를 주소로 등록하세요." />
      <NewItemForm mapKeys={{ keyId: env.ncpKeyId ?? null, vworldKey: env.vworldKey ?? null }} unit={unit} initialPick={initialPick} />
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
