"use server";

import { refresh } from "next/cache";
import { generateCompare } from "@/lib/ai/compare";
import { requireMember } from "@/lib/auth/session";
import { getItem } from "@/lib/queries/items";

export async function compareAction(ids: string[]): Promise<{ error?: string }> {
  const user = await requireMember();
  const items = (await Promise.all(ids.slice(0, 5).map((id) => getItem(user.id, id)))).filter((x) => x !== null);
  if (items.length < 2) return { error: "2개 이상 선택하세요." };
  try {
    await generateCompare(user.id, items);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  refresh();
  return {};
}
