import "server-only";
import { errorText } from "./openai-compat";
import { type AiProvider, PROVIDER_INFO } from "./providers";

export type ModelOption = { id: string; label?: string };

/**
 * 사용자가 넣은 Base URL 정리·검증. http(s)만, 계정 정보 없이. 평문 http 는 Ollama(자체 서버)에만 허용한다.
 * 빈 값이면 제공자 기본값.
 */
export function normalizeBaseUrl(provider: AiProvider, input: string | null | undefined): { url: string } | { error: string } {
  const raw = (input ?? "").trim();
  if (!raw) return { url: PROVIDER_INFO[provider].defaultBaseUrl };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: "Base URL 형식이 올바르지 않습니다(예: https://api.example.com/v1)." };
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && provider === "ollama")) {
    return { error: provider === "ollama" ? "http(s) 주소만 쓸 수 있습니다." : "https 주소만 쓸 수 있습니다." };
  }
  if (u.username || u.password) return { error: "Base URL 에 계정 정보를 넣지 마세요." };
  u.hash = "";
  u.search = "";
  return { url: u.toString().replace(/\/+$/, "") };
}

// 채팅에 쓸 수 없는 모델(임베딩·음성·이미지 등)
const NON_CHAT = /embed|tts|whisper|transcri|dall-e|image|imagen|veo|audio|realtime|moderation|aqa|davinci|babbage|search|similarity|rerank|learnlm|computer-use|sora|speech|vision-only|-live/i;

async function getJson(url: string, headers: Record<string, string>, apiKey: string | null, label: string) {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  } catch (e) {
    throw new Error(`${label} 서버에 연결하지 못했습니다(${e instanceof Error ? e.message : String(e)}).`);
  }
  if (!res.ok) {
    const msg = errorText(await res.text().catch(() => ""), apiKey);
    throw new Error(res.status === 401 || res.status === 403 ? `API 키 인증 실패(HTTP ${res.status}): ${msg}` : `모델 목록 조회 실패(HTTP ${res.status}): ${msg}`);
  }
  return res.json();
}

/** 제공자 서버에서 쓸 수 있는 모델 목록을 가져온다 */
export async function listModels(provider: AiProvider, apiKey: string | null, baseUrl: string): Promise<ModelOption[]> {
  const info = PROVIDER_INFO[provider];
  const base = baseUrl.replace(/\/+$/, "");
  if (provider === "anthropic") {
    if (!apiKey) throw new Error("API 키가 필요합니다.");
    const j = await getJson(`${base}/v1/models?limit=100`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, apiKey, info.label);
    return (j.data ?? []).map((m: { id: string; display_name?: string }) => ({ id: m.id, label: m.display_name }));
  }
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  let rows: { id: string; created?: number }[] = [];
  try {
    const j = await getJson(`${base}/models`, headers, apiKey, info.label);
    rows = j.data ?? j.models ?? [];
  } catch (e) {
    // 오래된 Ollama 는 OpenAI 호환 /v1/models 가 없을 수 있어 고유 API(/api/tags)로 다시 본다
    if (provider !== "ollama") throw e;
    const j = await getJson(`${base.replace(/\/v1$/, "")}/api/tags`, headers, apiKey, info.label);
    rows = (j.models ?? []).map((m: { name: string }) => ({ id: m.name }));
  }
  const ids = rows
    .map((m) => ({ id: String(m.id ?? (m as { name?: string }).name ?? "").replace(/^models\//, ""), created: m.created ?? 0 }))
    .filter((m) => m.id && !(provider === "ollama" ? /embed/i : NON_CHAT).test(m.id));
  ids.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  return [...new Map(ids.map((m) => [m.id, { id: m.id }])).values()];
}
