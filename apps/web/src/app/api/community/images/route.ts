import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { LIMITS } from "@/lib/community/rules";

const TYPES = ["image/jpeg", "image/webp", "image/png"];

/** 첨부 사진 업로드(브라우저에서 줄인 JPEG). 글을 저장하면 그 글에 연결되고, 하루 안에 연결되지 않으면 정리된다 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user || user.isGuest) return NextResponse.json({ error: "이메일 간편 가입 후 사진을 올릴 수 있습니다." }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  if (!TYPES.includes(file.type)) return NextResponse.json({ error: "JPEG·PNG·WebP 사진만 올릴 수 있습니다." }, { status: 400 });
  if (file.size > LIMITS.imageMaxBytes) return NextResponse.json({ error: "사진이 너무 큽니다(1.5MB 이하)." }, { status: 400 });
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from community_images where user_id = ${user.id} and created_at > now() - interval '1 day'`;
  if (n >= LIMITS.imagesPerDay) return NextResponse.json({ error: `사진은 하루 ${LIMITS.imagesPerDay}장까지 올릴 수 있습니다.` }, { status: 429 });
  const buf = Buffer.from(await file.arrayBuffer());
  // 파일 시그니처 확인(확장자·Content-Type 위조 방지)
  const sig = buf.subarray(0, 12);
  const ok = (sig[0] === 0xff && sig[1] === 0xd8) || sig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || (sig.toString("ascii", 0, 4) === "RIFF" && sig.toString("ascii", 8, 12) === "WEBP");
  if (!ok) return NextResponse.json({ error: "사진 파일이 아닙니다." }, { status: 400 });
  const [row] = await sql<{ id: string }[]>`
    insert into community_images (user_id, mime, bytes, data) values (${user.id}, ${file.type}, ${buf.length}, ${buf}) returning id`;
  return NextResponse.json({ id: row.id });
}
