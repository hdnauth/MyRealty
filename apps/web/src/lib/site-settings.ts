import "server-only";
import { cache } from "react";
import { sql } from "./db";
import { normalizeSiteSettings, type SiteSettings } from "./site-config";

export type { SiteSettings };

/** 요청 단위로 캐시 */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  const rows = await sql<{ key: string; value: unknown }[]>`select key, value from site_settings`;
  return normalizeSiteSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

export async function saveSiteSettings(patch: Partial<SiteSettings>, adminId: string) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) {
      // 값 없음 = 기본값 사용
      await sql`delete from site_settings where key = ${key}`;
      continue;
    }
    await sql`
      insert into site_settings (key, value, updated_by) values (${key}, ${sql.json(value as never)}, ${adminId})
      on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
  }
}
