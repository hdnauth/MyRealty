"use server";

import { refresh } from "next/cache";
import { generateReport, type ReportKind } from "@/lib/ai/reports";
import { requireMember } from "@/lib/auth/session";

export async function generateReportAction(kind: ReportKind): Promise<{ error?: string }> {
  const user = await requireMember();
  try {
    await generateReport(user.id, kind);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return {};
}
