"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export async function markAllReadAction() {
  const user = await requireUser();
  await sql`update notifications set read_at = now() where user_id = ${user.id} and read_at is null`;
  refresh();
}
