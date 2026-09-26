import "server-only";
import { cache } from "react";
import { sql } from "./db";
import { normalizeSiteSettings, type SiteSettings } from "./site-config";

export type { SiteSettings };

// 모든 화면(레이아웃 공지)에서 읽지만 거의 바뀌지 않아 서버 인스턴스 메모리에 잠깐 둔다.
// 저장하면 같은 인스턴스는 바로 비우고, 다른 인스턴스는 TTL 안에 따라온다.
const TTL_MS = 30_000;
let memo: { at: number; value: Promise<SiteSettings> } | null = null;

async function load(): Promise<SiteSettings> {
  const rows = await sql<{ key: string; value: unknown }[]>`select key, value from site_settings`;
  return normalizeSiteSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

/** 요청 단위 + 인스턴스 메모리(30초) 캐시 */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  if (!memo || Date.now() - memo.at > TTL_MS) {
    const value = load();
    memo = { at: Date.now(), value };
    value.catch(() => (memo = null)); // 실패는 캐시하지 않는다
  }
  return memo.value;
});

export function invalidateSiteSettings() {
  memo = null;
}

export async function saveSiteSettings(patch: Partial<SiteSettings>, adminId: string) {
  invalidateSiteSettings();
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
  invalidateSiteSettings();
}
