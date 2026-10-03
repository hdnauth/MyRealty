"use server";

import { refresh } from "next/cache";
import { ensureUser, requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { evalExpression } from "@/lib/queries/custom";

export async function previewAction(expression: string) {
  return evalExpression(expression);
}

export async function saveCustomAction(name: string, expression: string): Promise<{ error?: string }> {
  if (!name.trim()) return { error: "이름을 입력하세요." };
  const r = await evalExpression(expression);
  if ("error" in r) return { error: r.error };
  const user = await ensureUser().catch((e: Error) => e);
  if (user instanceof Error) return { error: user.message };
  await sql`insert into custom_indicators (user_id, name, expression) values (${user.id}, ${name.trim().slice(0, 60)}, ${expression})`;
  refresh();
  return {};
}

export async function deleteCustomAction(id: string) {
  const user = await requireUser();
  await sql`delete from custom_indicators where id = ${id} and user_id = ${user.id}`;
  refresh();
}
