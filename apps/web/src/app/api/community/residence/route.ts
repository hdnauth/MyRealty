import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { addResidenceCheck, RESIDENCE } from "@/lib/community/rules";

/**
 * 거주 인증 위치 확인. 브라우저가 보낸 좌표와 단지 좌표 사이 거리만 계산해 남기고 좌표 자체는 저장하지 않는다.
 * 서로 다른 날 RESIDENCE.days 번 반경 안이면 인증(1년 유지).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.isGuest) return NextResponse.json({ error: "이메일 간편 가입 후 거주 인증을 할 수 있습니다." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { complexId?: number; lat?: number; lng?: number; accuracy?: number } | null;
  const complexId = Number(body?.complexId);
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isSafeInteger(complexId) || !Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  if ((body?.accuracy ?? 0) > 500) return NextResponse.json({ error: "위치 정확도가 낮습니다. GPS가 잘 잡히는 곳에서 다시 시도하세요." }, { status: 400 });
  const [c] = await sql<{ dist: number | null }[]>`
    select ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)::float8 as dist from complexes where id = ${complexId}`;
  if (!c) return NextResponse.json({ error: "단지를 찾을 수 없습니다." }, { status: 404 });
  if (c.dist === null) return NextResponse.json({ error: "이 단지는 좌표가 없어 인증할 수 없습니다." }, { status: 400 });
  const [prev] = await sql<{ checks: { day: string; dist: number }[]; verified_at: string | null }[]>`
    select checks, verified_at::text from community_residences where user_id = ${user.id} and complex_id = ${complexId}`;
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // KST 날짜
  const r = addResidenceCheck(prev?.checks ?? [], day, c.dist);
  await sql`
    insert into community_residences (user_id, complex_id, checks, verified_at, expires_at)
    values (${user.id}, ${complexId}, ${sql.json(r.checks)}, ${r.verified ? new Date() : null}, ${r.verified ? new Date(Date.now() + RESIDENCE.validDays * 86400_000) : null})
    on conflict (user_id, complex_id) do update set checks = excluded.checks,
      verified_at = case when excluded.verified_at is not null and (community_residences.verified_at is null or community_residences.expires_at < now())
                         then excluded.verified_at else community_residences.verified_at end,
      expires_at = case when excluded.verified_at is not null then excluded.expires_at else community_residences.expires_at end`;
  return NextResponse.json({
    inRange: r.inRange,
    distance: Math.round(c.dist),
    days: r.checks.length,
    need: RESIDENCE.days,
    verified: r.verified || Boolean(prev?.verified_at),
  });
}
