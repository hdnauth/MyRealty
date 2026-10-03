import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Composer } from "@/components/community/composer";
import { Card, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/auth/session";
import { getPost, shortSgg } from "@/lib/community/queries";
import { updatePostAction } from "../../../actions";

export const metadata: Metadata = { title: "글 수정" };

export default async function EditPostPage(props: PageProps<"/community/posts/[id]/edit">) {
  const { id: raw } = await props.params;
  const user = await requireMember(`/community/posts/${raw}/edit`);
  const id = Number(raw);
  const post = Number.isSafeInteger(id) ? await getPost(id, user.id) : null;
  if (!post || !post.mine || post.kind !== "user" || post.status === "hidden") notFound();
  const board = post.complex_id ? `complex:${post.complex_id}` : `sgg:${post.sgg_cd}`;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="글 수정" sub={post.complex_name ?? shortSgg(post.sgg_name)} />
      <Card className="p-4">
        <Composer
          action={updatePostAction.bind(null, post.id)}
          boards={[{ value: board, label: post.complex_name ?? post.sgg_name, group: post.sgg_name, sgg: post.sgg_cd }]}
          initialBoard={board}
          initial={{ category: post.category, title: post.title, body: post.body, attachments: post.attachments }}
          editing
        />
      </Card>
    </div>
  );
}
