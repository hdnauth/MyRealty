"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { compareAction } from "./actions";

export function CompareButton({ ids, enabled }: { ids: string[]; enabled: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" className="h-8 px-2.5 text-xs" disabled={!enabled || pending || ids.length < 2} onClick={() => start(async () => setErr((await compareAction(ids)).error ?? null))}>
        <Sparkles size={14} /> {pending ? "분석 중…" : "AI 비교"}
      </Button>
      {err ? <span className="text-xs text-up">{err}</span> : null}
    </div>
  );
}
