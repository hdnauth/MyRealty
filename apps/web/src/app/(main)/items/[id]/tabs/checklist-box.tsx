"use client";

import { useOptimistic, useTransition } from "react";
import { toggleChecklistAction } from "../../actions";

export function ChecklistBox({ itemId, label, done }: { itemId: string; label: string; done: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [, start] = useTransition();
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        checked={optimistic}
        onChange={(e) => {
          const v = e.target.checked;
          start(async () => {
            setOptimistic(v);
            await toggleChecklistAction(itemId, label, v);
          });
        }}
      />
      <span className={optimistic ? "text-muted line-through" : ""}>{label}</span>
    </label>
  );
}
