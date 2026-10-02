"use server";

import { refresh } from "next/cache";
import { audit } from "@/lib/admin";
import { feedbackExcerpt, isAiReportReason, isAiSurface } from "@/lib/ai/feedback";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export type AiReportState = { error?: string; ok?: string };

const REPORTS_PER_DAY = 30;

export async function reportAiAction(surface: string, ref: string | null, excerpt: string, _: AiReportState, form: FormData): Promise<AiReportState> {
  const user = await requireUser();
  if (!isAiSurface(surface)) return { error: "잘못된 요청" };
  const reason = String(form.get("reason") ?? "");
  if (!isAiReportReason(reason)) return { error: "신고 사유를 고르세요." };
  const detail = String(form.get("detail") ?? "").trim().slice(0, 500) || null;
  const text = feedbackExcerpt(excerpt);
  if (!text) return { error: "신고할 내용이 없습니다." };
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from ai_feedback where user_id = ${user.id} and created_at > now() - interval '1 day'`;
  if (n >= REPORTS_PER_DAY) return { error: "오늘은 더 신고할 수 없습니다." };
  await sql`
    insert into ai_feedback (user_id, surface, ref, excerpt, reason, detail)
    values (${user.id}, ${surface}, ${ref?.slice(0, 200) ?? null}, ${text}, ${reason}, ${detail})`;
  return { ok: "신고했습니다. 운영자가 확인합니다." };
}

export async function resolveAiFeedbackAction(id: number) {
  const admin = await requireAdmin();
  await sql`update ai_feedback set status = 'resolved', resolved_at = now(), resolved_by = ${admin.id} where id = ${id} and status = 'open'`;
  await audit(admin, "ai.feedback.resolve", String(id));
  refresh();
}
