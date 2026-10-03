"use server";

import { refresh } from "next/cache";
import { type AiConfig, userAiRow } from "@/lib/ai/client";
import { pingModel } from "@/lib/ai/engine";
import { listModels, type ModelOption, normalizeBaseUrl } from "@/lib/ai/models";
import { type AiProvider, isAiProvider, PROVIDER_INFO } from "@/lib/ai/providers";
import { decryptSecret, encryptSecret, keyHint } from "@/lib/ai/secret";
import { requireMember } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export type AiForm = { provider: string; model?: string; apiKey?: string; baseUrl?: string };

/**
 * 폼 값을 호출 설정으로. 키를 비워 두면(변경 안 함) 같은 제공자로 저장된 키를 쓴다.
 * 키는 응답으로 돌려주지 않는다.
 */
async function toConfig(userId: string, f: AiForm): Promise<{ cfg: AiConfig } | { error: string }> {
  if (!isAiProvider(f.provider)) return { error: "제공자를 고르세요." };
  const provider: AiProvider = f.provider;
  const info = PROVIDER_INFO[provider];
  const base = normalizeBaseUrl(provider, f.baseUrl);
  if ("error" in base) return base;
  let apiKey = f.apiKey?.trim() || null;
  if (!apiKey) {
    const row = await userAiRow(userId);
    if (row?.provider === provider) apiKey = decryptSecret(row.api_key_enc);
  }
  if (!apiKey && !info.keyOptional) return { error: `${info.label} API 키를 입력하세요.` };
  if (apiKey && apiKey.length > 400) return { error: "API 키가 너무 깁니다." };
  return { cfg: { provider, model: (f.model ?? "").trim(), apiKey, baseUrl: base.url, ownKey: true } };
}

export async function loadAiModelsAction(f: AiForm): Promise<{ models?: ModelOption[]; error?: string }> {
  const user = await requireMember();
  const r = await toConfig(user.id, f);
  if ("error" in r) return r;
  try {
    const models = await listModels(r.cfg.provider, r.cfg.apiKey, r.cfg.baseUrl);
    return models.length ? { models } : { error: "쓸 수 있는 모델이 없습니다. 모델 이름을 직접 입력하세요." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function testAiAction(f: AiForm): Promise<{ ok: boolean; message: string }> {
  const user = await requireMember();
  const r = await toConfig(user.id, f);
  if ("error" in r) return { ok: false, message: r.error };
  if (!r.cfg.model) return { ok: false, message: "모델을 고르세요." };
  const t0 = Date.now();
  try {
    const reply = await pingModel(r.cfg);
    return { ok: true, message: `연결 성공 · ${((Date.now() - t0) / 1000).toFixed(1)}초 · 응답: ${reply.slice(0, 40)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveAiSettingsAction(f: AiForm): Promise<{ error?: string }> {
  const user = await requireMember();
  const r = await toConfig(user.id, f);
  if ("error" in r) return r;
  const { cfg } = r;
  if (!cfg.model || cfg.model.length > 200) return { error: "모델을 고르세요." };
  const typed = f.apiKey?.trim() || null;
  const prev = await userAiRow(user.id);
  // 새 키를 넣었으면 암호화해 바꾸고, 아니면 같은 제공자의 기존 키를 그대로 둔다
  const enc = typed ? encryptSecret(typed) : prev?.provider === cfg.provider ? prev.api_key_enc : null;
  const hint = typed ? keyHint(typed) : prev?.provider === cfg.provider ? prev.key_hint : null;
  const baseUrl = cfg.baseUrl === PROVIDER_INFO[cfg.provider].defaultBaseUrl ? null : cfg.baseUrl;
  await sql`
    insert into user_ai_settings (user_id, provider, model, base_url, api_key_enc, key_hint, updated_at)
    values (${user.id}, ${cfg.provider}, ${cfg.model}, ${baseUrl}, ${enc}, ${hint}, now())
    on conflict (user_id) do update set provider = excluded.provider, model = excluded.model, base_url = excluded.base_url,
      api_key_enc = excluded.api_key_enc, key_hint = excluded.key_hint, updated_at = now()`;
  refresh();
  return {};
}

/** 내 설정을 지우고 서버 기본으로 */
export async function clearAiSettingsAction(): Promise<void> {
  const user = await requireMember();
  await sql`delete from user_ai_settings where user_id = ${user.id}`;
  refresh();
}
