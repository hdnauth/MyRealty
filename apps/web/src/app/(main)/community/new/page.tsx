import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { type BoardOption, Composer } from "@/components/community/composer";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { canWrite, communityMe, shortSgg, sggNames, subscriptions } from "@/lib/community/queries";
import { isSgg, isUserCategory } from "@/lib/community/rules";
import { createPostAction } from "../actions";

export const metadata: Metadata = { title: "글쓰기" };

export default async function NewPostPage(props: PageProps<"/community/new">) {
  const [user, sp] = await Promise.all([requireUser(), props.searchParams]);
  const self = `/community/new?${new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string")).toString()}`;
  const me = await communityMe(user.id, user.isAdmin);
  if (!canWrite(me)) redirect(`/community/profile?next=${encodeURIComponent(self)}`);

  const subs = await subscriptions(user.id);
  const complexId = typeof sp.complex === "string" && /^\d+$/.test(sp.complex) ? Number(sp.complex) : null;
  const [extra] = complexId && !subs.complexes.some((c) => c.id === complexId)
    ? await sql<{ id: number; name: string; sgg: string }[]>`select id, name, sgg_cd as sgg from complexes where id = ${complexId}`
    : [];
  const sggParam = isSgg(sp.sgg) ? sp.sgg : null;
  const complexes = [...subs.complexes, ...(extra ? [{ ...extra, auto: false }] : [])];
  const sggCodes = [...new Set([...subs.sggs.map((s) => s.sgg), ...complexes.map((c) => c.sgg), ...(sggParam ? [sggParam] : [])])];
  const names = await sggNames(sggCodes);
  // 시군구마다 [시군구 게시판, 그 안의 단지 게시판들]
  const boards: BoardOption[] = sggCodes.flatMap((g) => [
    { value: `sgg:${g}`, label: `${shortSgg(names[g])} 전체`, group: names[g] ?? g, sgg: g },
    ...complexes.filter((c) => c.sgg === g).map((c) => ({ value: `complex:${c.id}`, label: c.name, group: names[g] ?? g, sgg: g })),
  ]);
  if (!boards.length) redirect("/community?nosubs=1");
  const initialBoard = complexId ? `complex:${complexId}` : sggParam ? `sgg:${sggParam}` : boards[0].value;

  const trade = typeof sp.trade === "string" && /^\d+$/.test(sp.trade) ? Number(sp.trade) : null;
  const category = isUserCategory(sp.cat) ? sp.cat : trade ? "opinion" : "question";
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="글쓰기" sub={`${me.nickname} 이름으로 올라갑니다`} />
      <Card className="p-4">
        <Composer
          action={createPostAction}
          boards={boards}
          initialBoard={initialBoard}
          initial={{ category, attachments: trade ? [{ type: "trade", id: trade }] : [], title: typeof sp.title === "string" ? sp.title.slice(0, 80) : undefined, poll: sp.poll === "outlook" ? "outlook" : "" }}
        />
      </Card>
    </div>
  );
}
