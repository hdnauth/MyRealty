"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { geocode } from "@/lib/external/geocode";
import { GROUP_TAGS, isPropertyType, makePnu, PROPERTY_TYPES } from "@/lib/property";
import { buildKeywords } from "@/lib/keywords";

export type ItemFormState = { error?: string };

function num(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function str(v: FormDataEntryValue | null): string | null {
  const s = v === null ? "" : String(v).trim();
  return s ? s : null;
}

/** 폼 → 대출/임대 JSON */
function parseFinance(form: FormData) {
  const loans = [];
  const loanAmount = num(form.get("loan_amount"));
  if (loanAmount) {
    loans.push({
      name: str(form.get("loan_name")) ?? "주택담보대출",
      amount: loanAmount,
      rate: num(form.get("loan_rate")) ?? 0,
      years: num(form.get("loan_years")) ?? 30,
      maturity: str(form.get("loan_maturity")),
    });
  }
  const leaseDeposit = num(form.get("lease_deposit"));
  const lease = leaseDeposit
    ? {
        kind: (num(form.get("lease_rent")) ?? 0) > 0 ? "wolse" : "jeonse",
        deposit: leaseDeposit,
        rent: num(form.get("lease_rent")) ?? 0,
        end_date: str(form.get("lease_end")),
        role: str(form.get("lease_role")) ?? "landlord",
      }
    : null;
  return { loans, lease };
}

export async function createItemAction(_: ItemFormState, form: FormData): Promise<ItemFormState> {
  const user = await requireUser();
  const type = String(form.get("property_type") ?? "");
  if (!isPropertyType(type)) return { error: "유형을 선택하세요." };
  const sggCd = str(form.get("sgg_cd"));
  const lawdCd = str(form.get("lawd_cd"));
  if (!sggCd || !/^\d{5}$/.test(sggCd)) return { error: "주소를 검색해 선택하세요." };
  const group = String(form.get("group_tag") ?? "watch");
  if (!(group in GROUP_TAGS)) return { error: "그룹이 올바르지 않습니다." };

  const bonbun = num(form.get("bonbun"));
  const mountain = form.get("mountain") === "1";
  const pnu = lawdCd && bonbun !== null ? makePnu(lawdCd, mountain, bonbun, num(form.get("bubun")) ?? 0) : null;
  const complexId = num(form.get("complex_id"));
  const roadAddr = str(form.get("road_address"));
  const jibunAddr = str(form.get("jibun_address"));
  const buildingName = str(form.get("building_name"));
  const label = str(form.get("label")) ?? str(form.get("default_label")) ?? buildingName ?? jibunAddr ?? "관심 물건";

  // 좌표: 단지 좌표 → 지오코딩 → 읍면동 중심
  let pt: [number, number] | null = null;
  if (complexId) {
    const [c] = await sql<{ lng: number | null; lat: number | null }[]>`
      select ST_X(geom) as lng, ST_Y(geom) as lat from complexes where id = ${complexId}`;
    if (c?.lng != null && c.lat != null) pt = [c.lng, c.lat];
  }
  if (!pt && (roadAddr || jibunAddr)) pt = await geocode(roadAddr ?? jibunAddr!);
  if (!pt && jibunAddr) pt = await geocode(jibunAddr);
  if (!pt && lawdCd) {
    const [r] = await sql<{ lng: number | null; lat: number | null }[]>`
      select ST_X(center) as lng, ST_Y(center) as lat from regions where lawd_cd = ${lawdCd}`;
    if (r?.lng != null && r.lat != null) pt = [r.lng, r.lat];
  }

  const { loans, lease } = parseFinance(form);
  const sidoName = str(form.get("sido_name"));
  const sggName = str(form.get("sgg_name"));
  const emdName = str(form.get("emd_name"));
  const keywords = buildKeywords({ type, buildingName, emdName, sggName, extra: str(form.get("keywords")) });
  const isLand = type === "land" || type === "forest";
  const area = num(form.get("area_m2"));

  const [row] = await sql.begin(async (tx) => {
    // 지역·수집 대상 등록 (ETL 이 이 시군구 실거래를 모으기 시작)
    if (lawdCd && /^\d{10}$/.test(lawdCd)) {
      await tx`insert into regions (lawd_cd, sido, sigungu, emd, level) values (${lawdCd}, ${sidoName}, ${sggName}, ${emdName}, 3)
               on conflict (lawd_cd) do update set sido = coalesce(regions.sido, excluded.sido),
                 sigungu = coalesce(regions.sigungu, excluded.sigungu), emd = coalesce(regions.emd, excluded.emd)`;
    }
    await tx`insert into regions (lawd_cd, sido, sigungu, level) values (${sggCd + "00000"}, ${sidoName}, ${sggName}, 2)
             on conflict (lawd_cd) do nothing`;
    await tx`insert into collect_targets (sgg_cd, name) values (${sggCd}, ${[sidoName, sggName].filter(Boolean).join(" ") || null})
             on conflict (sgg_cd) do update set enabled = true, name = coalesce(collect_targets.name, excluded.name)`;
    return tx<{ id: string }[]>`
      insert into watch_items (user_id, property_type, label, group_tag, road_address, jibun_address, building_name,
        lawd_cd, sgg_cd, pnu, complex_id, dong_ho, area_m2, land_area_m2, floor, geom, purchase_price, purchase_date,
        loans, lease, keywords, radius_m)
      values (${user.id}, ${type}, ${label}, ${group}, ${roadAddr}, ${jibunAddr}, ${buildingName},
        ${lawdCd}, ${sggCd}, ${pnu}, ${complexId}, ${str(form.get("dong_ho"))},
        ${isLand ? null : area}, ${isLand ? area : num(form.get("land_area_m2"))}, ${num(form.get("floor"))},
        ${pt ? sql`ST_SetSRID(ST_MakePoint(${pt[0]}, ${pt[1]}), 4326)` : null},
        ${num(form.get("purchase_price"))}, ${str(form.get("purchase_date"))},
        ${sql.json(loans)}, ${lease ? sql.json(lease) : null}, ${keywords},
        ${num(form.get("radius_m")) ?? (PROPERTY_TYPES[type].hasComplex ? 1000 : 2000)})
      returning id`;
  });
  redirect(`/items/${row.id}`);
}

export async function updateItemAction(id: string, _: ItemFormState, form: FormData): Promise<ItemFormState> {
  const user = await requireUser();
  const group = String(form.get("group_tag") ?? "watch");
  if (!(group in GROUP_TAGS)) return { error: "그룹이 올바르지 않습니다." };
  const { loans, lease } = parseFinance(form);
  const [cur] = await sql<{ property_type: string }[]>`select property_type from watch_items where id = ${id} and user_id = ${user.id}`;
  if (!cur) return { error: "물건을 찾을 수 없습니다." };
  const isLand = cur.property_type === "land" || cur.property_type === "forest";
  const area = num(form.get("area_m2"));
  const keywords = String(form.get("keywords") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const res = await sql`
    update watch_items set
      label = ${str(form.get("label")) ?? "관심 물건"},
      group_tag = ${group},
      dong_ho = ${str(form.get("dong_ho"))},
      area_m2 = ${isLand ? null : area},
      land_area_m2 = ${isLand ? area : sql`land_area_m2`},
      floor = ${num(form.get("floor"))},
      purchase_price = ${num(form.get("purchase_price"))},
      purchase_date = ${str(form.get("purchase_date"))},
      loans = ${sql.json(loans)},
      lease = ${lease ? sql.json(lease) : null},
      keywords = ${keywords},
      radius_m = ${num(form.get("radius_m")) ?? 1000},
      updated_at = now()
    where id = ${id} and user_id = ${user.id}`;
  if (res.count === 0) return { error: "물건을 찾을 수 없습니다." };
  redirect(`/items/${id}`);
}

export async function deleteItemAction(id: string) {
  const user = await requireUser();
  await sql`delete from watch_items where id = ${id} and user_id = ${user.id}`;
  redirect("/items");
}

export async function markItemNotificationsRead(id: string) {
  const user = await requireUser();
  await sql`update notifications set read_at = now() where user_id = ${user.id} and watch_item_id = ${id} and read_at is null`;
  refresh();
}

export async function analyzeItemAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const { getItem } = await import("@/lib/queries/items");
  const { generateAnalysis } = await import("@/lib/ai/analysis");
  const item = await getItem(user.id, id);
  if (!item) return { error: "물건을 찾을 수 없습니다." };
  try {
    await generateAnalysis(user.id, item);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return {};
}

export async function addNoteAction(itemId: string, form: FormData) {
  const user = await requireUser();
  const body = String(form.get("body") ?? "").trim().slice(0, 5000);
  if (!body) return;
  const own = await sql`select 1 from watch_items where id = ${itemId} and user_id = ${user.id}`;
  if (!own.length) return;
  await sql`insert into notes (user_id, watch_item_id, body) values (${user.id}, ${itemId}, ${body})`;
  refresh();
}

export async function deleteNoteAction(noteId: string) {
  const user = await requireUser();
  await sql`delete from notes where id = ${noteId} and user_id = ${user.id}`;
  refresh();
}

export async function toggleChecklistAction(itemId: string, label: string, done: boolean) {
  const user = await requireUser();
  const own = await sql`select 1 from watch_items where id = ${itemId} and user_id = ${user.id}`;
  if (!own.length) return;
  const [row] = await sql<{ id: string; checklist: Record<string, boolean> }[]>`
    select id, checklist from notes where watch_item_id = ${itemId} and user_id = ${user.id} and checklist is not null limit 1`;
  const next = { ...(row?.checklist ?? {}), [label]: done };
  if (row) await sql`update notes set checklist = ${sql.json(next)} where id = ${row.id}`;
  else await sql`insert into notes (user_id, watch_item_id, body, checklist) values (${user.id}, ${itemId}, '', ${sql.json(next)})`;
  refresh();
}
