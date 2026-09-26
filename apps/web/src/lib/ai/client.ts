import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "../db";
import { env } from "../env";

let _client: Anthropic | null = null;

export function aiEnabled() {
  return Boolean(env.anthropicApiKey);
}

export function anthropic(): Anthropic {
  if (!env.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  _client ??= new Anthropic({ apiKey: env.anthropicApiKey });
  return _client;
}

export const MODEL = env.anthropicModel;

/**
 * 서버 측 거절 폴백: Opus 5 계열·Fable 에서 안전 분류기가 요청을 거절하면 API 가 권장 모델로 재실행한다.
 * (fallbacks: "default" + server-side-fallback-2026-07-01). 다른 모델에는 붙이지 않는다.
 */
export function fallbackParams(model = MODEL): { betas?: string[]; fallbacks?: "default" } {
  return /^claude-(opus-5|fable-5)/.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
}

/** Haiku 4.5 는 effort 미지원 */
export function effortConfig(effort: "low" | "medium" | "high" | "xhigh", model = MODEL) {
  return model.startsWith("claude-haiku-4-5") ? {} : { effort };
}

const PRICES: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
  "claude-fable-5-1": [10, 50],
};

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export async function recordUsage(purpose: string, model: string, u: Usage) {
  const [pin, pout] = PRICES[model] ?? [5, 25];
  const inp = u.input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  const cw = u.cache_creation_input_tokens ?? 0;
  const cost = (inp * pin + cr * pin * 0.1 + cw * pin * 1.25 + out * pout) / 1_000_000;
  await sql`insert into ai_usage (purpose, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd)
            values (${purpose}, ${model}, ${inp}, ${out}, ${cr}, ${cw}, ${cost})`;
}

export async function monthSpend(): Promise<number> {
  const [r] = await sql<{ s: number }[]>`
    select coalesce(sum(cost_usd), 0)::float8 as s from ai_usage where created_at >= date_trunc('month', now())`;
  return r.s;
}

export async function budgetOk(): Promise<boolean> {
  const budget = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 30);
  return (await monthSpend()) < budget;
}

export function textOf(content: { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}
