import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "../db";
import { env } from "../env";
import { getSiteSettings } from "../site-settings";
import { type AiProvider, isAiProvider, PROVIDER_INFO } from "./providers";
import { decryptSecret } from "./secret";

/**
 * AI 호출 설정. 사용자가 설정 화면에서 제공자·모델·키를 넣었으면 그것(본인 키, 비용은 사용자 부담),
 * 아니면 서버 기본(ANTHROPIC_API_KEY + ANTHROPIC_MODEL, 서버 예산·개인 한도 적용).
 */
export type AiConfig = {
  provider: AiProvider;
  model: string;
  apiKey: string | null;
  baseUrl: string;
  ownKey: boolean;
};

export const MODEL = env.anthropicModel;

/** 서버 기본 AI(ANTHROPIC_API_KEY) — ETL 뉴스 분류 등 사용자와 무관한 표시에 쓴다 */
export function serverAiEnabled() {
  return Boolean(env.anthropicApiKey);
}

function serverConfig(): AiConfig | null {
  if (!env.anthropicApiKey) return null;
  return { provider: "anthropic", model: MODEL, apiKey: env.anthropicApiKey, baseUrl: PROVIDER_INFO.anthropic.defaultBaseUrl, ownKey: false };
}

export type UserAiRow = { provider: string; model: string; base_url: string | null; api_key_enc: string | null; key_hint: string | null; updated_at: string };

// 0010 마이그레이션 전(배포 직후 잠깐)에는 새 테이블·컬럼이 없을 수 있다
const missingSchema = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");

export async function userAiRow(userId: string): Promise<UserAiRow | null> {
  try {
    const [r] = await sql<UserAiRow[]>`
      select provider, model, base_url, api_key_enc, key_hint, updated_at::text from user_ai_settings where user_id = ${userId}`;
    return r ?? null;
  } catch (e) {
    if (missingSchema(e)) return null;
    throw e;
  }
}

/** 사용자 설정을 우선으로 AI 설정을 고른다. problem 은 사용자 설정이 있는데 쓸 수 없는 이유 */
export async function resolveAi(userId: string): Promise<{ cfg: AiConfig | null; problem: string | null }> {
  const row = await userAiRow(userId);
  if (row && isAiProvider(row.provider)) {
    const info = PROVIDER_INFO[row.provider];
    const apiKey = decryptSecret(row.api_key_enc);
    if (row.api_key_enc && !apiKey) {
      return { cfg: serverConfig(), problem: "저장된 AI 키를 해독하지 못했습니다(서버 비밀값 변경). 설정에서 키를 다시 입력하세요." };
    }
    if (!apiKey && !info.keyOptional) return { cfg: serverConfig(), problem: `${info.label} API 키가 없습니다. 설정에서 키를 입력하세요.` };
    return {
      cfg: { provider: row.provider, model: row.model, apiKey, baseUrl: row.base_url || info.defaultBaseUrl, ownKey: true },
      problem: null,
    };
  }
  return { cfg: serverConfig(), problem: null };
}

/** 화면 표시용: 사용 가능 여부와 "OpenAI GPT · gpt-5" 같은 이름 */
export async function aiStatus(userId: string): Promise<{ enabled: boolean; label: string | null; ownKey: boolean; problem: string | null }> {
  const { cfg, problem } = await resolveAi(userId);
  return { enabled: Boolean(cfg), label: cfg ? `${PROVIDER_INFO[cfg.provider].label} · ${cfg.model}` : null, ownKey: cfg?.ownKey ?? false, problem };
}

export const AI_DISABLED_MESSAGE = "AI 설정이 없습니다. 메뉴 › 설정 › AI 모델에서 제공자·모델·API 키를 등록하세요.";

/** 쓸 수 있는 설정을 돌려주거나(서버 키는 예산 확인 포함) 사용자 문구로 예외를 던진다 */
export async function requireAi(userId: string): Promise<AiConfig> {
  const { cfg, problem } = await resolveAi(userId);
  if (!cfg) throw new Error(problem ?? AI_DISABLED_MESSAGE);
  const quota = await aiQuotaError(userId, cfg);
  if (quota) throw new Error(quota);
  return cfg;
}

const clients = new Map<string, Anthropic>();

export function anthropic(cfg?: AiConfig | null): Anthropic {
  const c = cfg ?? serverConfig();
  if (!c?.apiKey) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  const baseURL = c.baseUrl.replace(/\/+$/, "");
  const k = `${baseURL}|${c.apiKey}`;
  let client = clients.get(k);
  if (!client) {
    if (clients.size > 50) clients.clear();
    client = new Anthropic({ apiKey: c.apiKey, baseURL });
    clients.set(k, client);
  }
  return client;
}

/**
 * 서버 측 거절 폴백: Opus 5 계열·Fable 에서 안전 분류기가 요청을 거절하면 API 가 권장 모델로 재실행한다.
 * (fallbacks: "default" + server-side-fallback-2026-07-01). 다른 모델에는 붙이지 않는다.
 */
export function fallbackParams(model = MODEL): { betas?: string[]; fallbacks?: "default" } {
  return /^claude-(opus-5|fable-5)/.test(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
}

/** effort 는 Opus 4.5·Claude 4.6 이후 Opus·Sonnet·Fable 계열만(Haiku·이전 모델은 미지원 → 생략하면 기본값) */
export function effortConfig(effort: "low" | "medium" | "high" | "xhigh", model = MODEL) {
  return /^claude-(opus|sonnet|fable)-[5-9]/.test(model) || /^claude-(opus-4-[5-9]|sonnet-4-[6-9])/.test(model) ? { effort } : {};
}

const PRICES: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
  "claude-fable-5-1": [10, 50],
};

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** 사용 기록. 본인 키 사용분은 비용 0(서버 예산·개인 한도에서 제외)으로 남긴다 */
export async function recordUsage(purpose: string, model: string, u: Usage, userId: string | null = null, cfg: AiConfig | null = null) {
  const provider = cfg?.provider ?? "anthropic";
  const ownKey = cfg?.ownKey ?? false;
  const [pin, pout] = PRICES[model] ?? [5, 25];
  const inp = u.input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  const cw = u.cache_creation_input_tokens ?? 0;
  const cost = ownKey ? 0 : (inp * pin + cr * pin * 0.1 + cw * pin * 1.25 + out * pout) / 1_000_000;
  try {
    await sql`insert into ai_usage (purpose, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, user_id, provider, own_key)
              values (${purpose}, ${model}, ${inp}, ${out}, ${cr}, ${cw}, ${cost}, ${userId}, ${provider}, ${ownKey})`;
  } catch (e) {
    if (!missingSchema(e)) throw e;
    await sql`insert into ai_usage (purpose, model, input_tokens, output_tokens, cache_read, cache_write, cost_usd, user_id)
              values (${purpose}, ${model}, ${inp}, ${out}, ${cr}, ${cw}, ${cost}, ${userId})`;
  }
}

export async function monthSpend(): Promise<number> {
  const [r] = await sql<{ s: number }[]>`
    select coalesce(sum(cost_usd), 0)::float8 as s from ai_usage where created_at >= date_trunc('month', now())`;
  return r.s;
}

export function monthlyBudget(): number {
  return Number(process.env.AI_MONTHLY_BUDGET_USD ?? 30);
}

export async function userMonthSpend(userId: string): Promise<number> {
  const [r] = await sql<{ s: number }[]>`
    select coalesce(sum(cost_usd), 0)::float8 as s from ai_usage
    where user_id = ${userId} and created_at >= date_trunc('month', now())`;
  return r.s;
}

/** 서버 키 사용일 때만 전체 월 예산과 사용자별 월 한도(관리 화면 설정)를 확인한다. 초과면 사용자 문구, 아니면 null. */
export async function aiQuotaError(userId: string, cfg: AiConfig | null = null): Promise<string | null> {
  if (cfg?.ownKey) return null;
  if ((await monthSpend()) >= monthlyBudget()) return "이번 달 서버 AI 예산(AI_MONTHLY_BUDGET_USD)을 모두 사용했습니다. 설정 › AI 모델에서 본인 키를 등록하면 계속 쓸 수 있습니다.";
  const { aiUserMonthlyLimitUsd: limit } = await getSiteSettings();
  if (limit !== null && (await userMonthSpend(userId)) >= limit) {
    return `이번 달 개인 AI 사용 한도($${limit})를 모두 사용했습니다. 설정 › AI 모델에서 본인 키를 등록하거나 다음 달에 다시 이용하세요.`;
  }
  return null;
}

export function textOf(content: { type: string; text?: string }[]): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}
