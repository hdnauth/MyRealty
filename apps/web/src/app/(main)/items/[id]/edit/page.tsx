import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { getItem } from "@/lib/queries/items";
import { EditItemForm } from "./edit-form";

export const metadata: Metadata = { title: "물건 수정" };

export default async function EditItemPage(props: PageProps<"/items/[id]/edit">) {
  const user = await requireUser();
  const { id } = await props.params;
  const item = await getItem(user.id, id);
  if (!item) notFound();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="물건 수정" sub={item.road_address ?? item.jibun_address ?? undefined} />
      <EditItemForm item={item} />
    </div>
  );
}
