"use client";

import { useActionState } from "react";
import { DetailFields } from "@/components/items/detail-fields";
import { Button, Card } from "@/components/ui";
import type { WatchItem } from "@/lib/queries/items";
import { deleteItemAction, type ItemFormState, updateItemAction } from "../../actions";

export function EditItemForm({ item }: { item: WatchItem }) {
  const [state, action, pending] = useActionState<ItemFormState, FormData>(updateItemAction.bind(null, item.id), {});
  const isLand = item.property_type === "land" || item.property_type === "forest";
  return (
    <Card className="p-4">
      <form action={action} className="space-y-4">
        <DetailFields d={item} isLand={isLand} showKeywords />
        {state.error ? <p className="text-sm text-up">{state.error}</p> : null}
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            className="text-up"
            onClick={() => {
              if (confirm("이 부동산을 삭제할까요? 관련 알림·메모도 함께 삭제됩니다.")) deleteItemAction(item.id);
            }}
          >
            삭제
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "저장 중…" : "저장"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
