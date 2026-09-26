"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { generateReportAction } from "./actions";

export function GenerateButtons({ enabled }: { enabled: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {(["weekly", "monthly"] as const).map((k) => (
          <Button
            key={k}
            variant="secondary"
            className="h-8 px-2.5 text-xs"
            disabled={!enabled || pending}
            onClick={() =>
              start(async () => {
                setErr((await generateReportAction(k)).error ?? null);
              })
            }
          >
            {pending ? "생성 중…" : k === "weekly" ? "주간 생성" : "월간 생성"}
          </Button>
        ))}
      </div>
      {err ? <span className="text-xs text-up">{err}</span> : null}
    </div>
  );
}
