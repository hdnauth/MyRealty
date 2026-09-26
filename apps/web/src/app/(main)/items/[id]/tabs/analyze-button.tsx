"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { analyzeItemAction } from "../../actions";

export function AnalyzeButton({ itemId, enabled, hasCard }: { itemId: string; enabled: boolean; hasCard: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" className="h-8 px-2.5 text-xs" disabled={!enabled || pending} onClick={() => start(async () => setErr((await analyzeItemAction(itemId)).error ?? null))}>
        <Sparkles size={14} /> {pending ? "분석 중…" : hasCard ? "다시 분석" : "분석 생성"}
      </Button>
      {err ? <span className="text-xs text-up">{err}</span> : null}
    </div>
  );
}
