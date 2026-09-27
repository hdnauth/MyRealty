import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { getItem } from "@/lib/queries/items";
import { EditItemForm } from "./edit-form";

export const metadata: Metadata = { title: "부동산 수정" };

export default async function EditItemPage(props: PageProps<"/items/[id]/edit">) {
  const [uid, { id }] = await Promise.all([sessionUserId(), props.params]);
  const [, item] = await Promise.all([requireUser(), getItem(uid, id)]);
  if (!item) notFound();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="부동산 수정" sub={item.road_address ?? item.jibun_address ?? undefined} />
      <EditItemForm item={item} />
    </div>
  );
}
