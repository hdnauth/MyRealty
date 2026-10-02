"use client";

import { Flag } from "lucide-react";
import { useActionState, useState } from "react";
import { type AiReportState, reportAiAction } from "@/app/(main)/ai/feedback-actions";
import { Button, Select, Textarea } from "@/components/ui";
import { AI_REPORT_REASONS, type AiSurface } from "@/lib/ai/feedback";

/** AI가 만든 답변·리포트·요약 신고. 신고 내용(발췌)은 관리 → 커뮤니티에서 확인한다 */
export function AiReportButton({ surface, refId, excerpt }: { surface: AiSurface; refId?: string | null; excerpt: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(reportAiAction.bind(null, surface, refId ?? null, excerpt), {} as AiReportState);
  if (state.ok) return <span className="text-xs text-muted">{state.ok}</span>;
  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-up">
        <Flag size={12} />
        AI 답변 신고
      </button>
      {open ? (
        <form action={action} className="absolute left-0 z-20 mt-1 w-64 space-y-2 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <p className="text-xs font-medium">신고 사유</p>
          <Select name="reason" defaultValue="" required className="h-9 text-sm">
            <option value="" disabled>선택</option>
            {Object.entries(AI_REPORT_REASONS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
          <Textarea name="detail" rows={2} maxLength={500} placeholder="자세한 내용(선택)" className="text-sm" />
          {state.error ? <p className="text-xs text-up">{state.error}</p> : null}
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setOpen(false)}>취소</Button>
            <Button type="submit" variant="danger" className="h-8 px-3 text-xs" disabled={pending}>신고</Button>
          </div>
        </form>
      ) : null}
    </span>
  );
}
