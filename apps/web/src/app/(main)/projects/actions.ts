"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { geocode } from "@/lib/external/geocode";

export type ProjectFormState = { error?: string; ok?: string };

const ZONE_STAGES = ["기본계획", "정비구역지정", "추진위", "조합설립", "사업시행인가", "관리처분인가", "이주·철거", "착공", "준공"];
const INFRA_STATUS = ["계획", "예타", "설계", "착공", "개통예정", "개통"];

function str(v: FormDataEntryValue | null) {
  const s = v === null ? "" : String(v).trim();
  return s || null;
}

export async function addProjectAction(_: ProjectFormState, form: FormData): Promise<ProjectFormState> {
  await requireUser();
  const type = form.get("type") === "infra" ? "infra" : "zone";
  const name = str(form.get("name"));
  if (!name) return { error: "이름을 입력하세요." };
  let pt: [number, number] | null = null;
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  if (lat && lng) pt = [lng, lat];
  else if (str(form.get("address"))) pt = await geocode(str(form.get("address"))!);
  if (!pt) return { error: "좌표를 찾지 못했습니다. 주소를 확인하거나 위도·경도를 입력하세요(지오코딩 키 필요)." };
  const key = `manual:${type}:${name}:${Date.now()}`;
  if (type === "zone") {
    const stage = str(form.get("stage"));
    await sql`
      insert into redevelopment_zones (source_key, name, kind, stage, stage_order, stage_date, households_plan, address, geom)
      values (${key}, ${name}, ${str(form.get("kind")) ?? "재건축"}, ${stage}, ${stage ? ZONE_STAGES.indexOf(stage) + 1 || null : null},
        ${str(form.get("date"))}, ${Number(form.get("households")) || null}, ${str(form.get("address"))},
        ST_SetSRID(ST_MakePoint(${pt[0]}, ${pt[1]}), 4326))`;
  } else {
    const status = str(form.get("status")) ?? "계획";
    await sql`
      insert into infra_projects (source_key, kind, name, line_name, status, status_order, expected_open, geom)
      values (${key}, ${str(form.get("infra_kind")) ?? "station"}, ${name}, ${str(form.get("line_name"))}, ${status},
        ${INFRA_STATUS.indexOf(status) + 1 || null}, ${str(form.get("date"))}, ST_SetSRID(ST_MakePoint(${pt[0]}, ${pt[1]}), 4326))`;
  }
  refresh();
  return { ok: `${name} 등록됨. 다음 ETL(pois/locations)에서 입지 점수에 반영됩니다.` };
}

export async function deleteProjectAction(form: FormData) {
  await requireUser();
  const id = Number(form.get("id"));
  if (form.get("type") === "infra") await sql`delete from infra_projects where id = ${id}`;
  else await sql`delete from redevelopment_zones where id = ${id}`;
  refresh();
}
