import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { sql } from "../db";
import type { WatchItem } from "../queries/items";
import { itemSnapshot } from "./analysis";
import { anthropic, aiQuotaError, effortConfig, fallbackParams, MODEL, recordUsage } from "./client";
import { todayLine } from "./prompts";

export const CompareResult = z.object({
  summary: z.string().describe("비교 핵심 2~3문장"),
  items: z.array(z.object({ name: z.string(), pros: z.array(z.string()), cons: z.array(z.string()) })),
  fits: z.array(z.object({ condition: z.string().describe("예: 학령기 자녀 실거주, 대출 부담 최소화, 장기 보유"), better: z.string(), reason: z.string() })),
  watch_points: z.array(z.string()),
});
export type CompareResult = z.infer<typeof CompareResult>;

const SYSTEM = `당신은 한국 부동산 비교 분석가입니다. 여러 관심 물건의 데이터(JSON)만 근거로 차이를 정리합니다.
- 장단점은 수치 인용이 있는 구체 문장으로. 데이터가 없는 비교는 하지 않습니다.
- "fits" 는 조건별로 어느 물건이 데이터상 더 부합하는지와 근거를 적되, 매수 권유 표현은 쓰지 않습니다.
- 금액은 만원 입력을 억/만으로 표기합니다. 데모(합성) 데이터면 summary 에 밝힙니다.`;

export async function generateCompare(userId: string, items: WatchItem[]) {
  const quota = await aiQuotaError(userId);
  if (quota) throw new Error(quota);
  const snaps = await Promise.all(items.map((i) => itemSnapshot(i)));
  const msg = await anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: todayLine() },
    ],
    messages: [{ role: "user", content: `다음 물건들을 비교하세요.\n\n${JSON.stringify(snaps)}` }],
    output_config: { format: betaZodOutputFormat(CompareResult), ...effortConfig("high") },
    ...fallbackParams(),
  });
  await recordUsage("compare", msg.model, msg.usage, userId);
  if (msg.stop_reason === "refusal" || !msg.parsed_output) throw new Error("비교 분석을 생성하지 못했습니다.");
  const ids = items.map((i) => i.id).sort();
  await sql`insert into ai_reports (user_id, scope, target_ids, title, content_md, data, model)
            values (${userId}, 'compare', ${ids}, ${msg.parsed_output.summary.slice(0, 120)}, '', ${sql.json({ result: msg.parsed_output } as never)}, ${msg.model})`;
  return msg.parsed_output;
}

export async function latestCompare(userId: string, ids: string[]) {
  const sorted = [...ids].sort();
  const [r] = await sql<{ data: { result: CompareResult }; created_at: string }[]>`
    select data, created_at::text from ai_reports
    where user_id = ${userId} and scope = 'compare' and target_ids = ${sorted}::uuid[] order by created_at desc limit 1`;
  return r ?? null;
}
