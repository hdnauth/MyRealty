import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

/** 첨부 사진. 보이는 글의 사진이거나, 아직 글에 붙이지 않은 내 사진만 */
export async function GET(_: Request, ctx: RouteContext<"/api/community/images/[id]">) {
  const user = await getUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("not found", { status: 404 });
  const [img] = await sql<{ mime: string; data: Buffer }[]>`
    select i.mime, i.data from community_images i left join community_posts p on p.id = i.post_id
    where i.id = ${id} and (i.user_id = ${user.id} or ${user.isAdmin} or p.status = 'visible')`;
  if (!img) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(img.data), {
    headers: { "content-type": img.mime, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" },
  });
}
