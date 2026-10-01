import "server-only";
import { z } from "zod";
import { sql } from "../db";
import type { WatchItem } from "../queries/items";
import { itemSnapshot } from "./analysis";
import { requireAi } from "./client";
import { generateObject } from "./engine";

export const CompareResult = z.object({
  summary: z.string().describe("비교 핵심 2~3문장"),
  items: z.array(z.object({ name: z.string(), pros: z.array(z.string()), cons: z.array(z.string()) })),
  fits: z.array(z.object({ condition: z.string().describe("예: 학령기 자녀 실거주, 대출 부담 최소화, 장기 보유"), better: z.string(), reason: z.string() })),
  watch_points: z.array(z.string()),
});
export type CompareResult = z.infer<typeof CompareResult>;

const SYSTEM = `당신은 한국 부동산 비교 분석가입니다. 여러 관심 부동산의 데이터(JSON)만 근거로 차이를 정리합니다.
- 장단점은 수치 인용이 있는 구체 문장으로. 데이터가 없는 비교는 하지 않습니다.
- "fits" 는 조건별로 어느 부동산이 데이터상 더 부합하는지와 근거를 적되, 매수 권유 표현은 쓰지 않습니다.
- 금액은 만원 입력을 억/만으로 표기합니다. 데모(합성) 데이터면 summary 에 밝힙니다.`;

export async function generateCompare(userId: string, items: WatchItem[]) {
  const cfg = await requireAi(userId);
  const snaps = await Promise.all(items.map((i) => itemSnapshot(i)));
  const { data: result } = await generateObject({
    cfg,
    userId,
    purpose: "compare",
    system: SYSTEM,
    prompt: `다음 부동산들을 비교하세요.\n\n${JSON.stringify(snaps)}`,
    schema: CompareResult,
    schemaName: "compare_result",
    effort: "high",
  });
  const ids = items.map((i) => i.id).sort();
  await sql`insert into ai_reports (user_id, scope, target_ids, title, content_md, data, model)
            values (${userId}, 'compare', ${ids}, ${result.summary.slice(0, 120)}, '', ${sql.json({ result } as never)}, ${cfg.model})`;
  return result;
}

export async function latestCompare(userId: string, ids: string[]) {
  const sorted = [...ids].sort();
  const [r] = await sql<{ data: { result: CompareResult }; created_at: string }[]>`
    select data, created_at::text from ai_reports
    where user_id = ${userId} and scope = 'compare' and target_ids = ${sorted}::uuid[] order by created_at desc limit 1`;
  return r ?? null;
}
