import "server-only";
import type { AiConfig, Usage } from "./client";
import { maxOutputTokens, PROVIDER_INFO } from "./providers";

/*
 * OpenAI Chat Completions 호환 API(OpenAI·Gemini·DeepSeek·MiMo·Ollama) 최소 클라이언트.
 * 제공자마다 지원하는 파라미터가 조금씩 달라(max_tokens/max_completion_tokens, stream_options, json_schema)
 * 400 응답이 특정 파라미터를 지목하면 그 파라미터를 빼거나 바꿔 한 번 더 보낸다.
 */

export type OaiToolCall = { id: string; type: "function"; function: { name: string; arguments: string }; extra_content?: unknown };
export type OaiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OaiToolCall[]; reasoning_content?: string }
  | { role: "tool"; tool_call_id: string; content: string };
export type OaiTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
export type OaiResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };

export type OaiResult = {
  model: string;
  content: string;
  reasoning: string;
  toolCalls: OaiToolCall[];
  finishReason: string | null;
  usage: Usage;
};

export class AiHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Body = Record<string, unknown>;

function headers(cfg: AiConfig): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) h.authorization = `Bearer ${cfg.apiKey}`;
  return h;
}

export function baseOf(cfg: Pick<AiConfig, "baseUrl">) {
  return cfg.baseUrl.replace(/\/+$/, "");
}

/** 오류 본문에서 사람이 읽을 문구만(키가 섞여 있으면 가린다) */
export function errorText(raw: string, apiKey: string | null): string {
  let msg = raw;
  try {
    const j = JSON.parse(raw);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    msg = typeof e === "string" ? e : (e?.message ?? j.message ?? raw);
  } catch {
    /* 본문이 JSON 이 아님 */
  }
  if (apiKey && apiKey.length >= 6) msg = msg.split(apiKey).join("***");
  return msg.replace(/\s+/g, " ").slice(0, 300);
}

/** 400 이 특정 파라미터를 지목하면 그 파라미터를 고친 본문, 아니면 null */
function relax(b: Body, text: string): Body | null {
  const t = text.toLowerCase();
  const next = { ...b };
  if (next.stream_options && t.includes("stream_options")) {
    delete next.stream_options;
    return next;
  }
  const rf = next.response_format as OaiResponseFormat | undefined;
  if (rf && /response_format|json_schema|json schema|structured/.test(t)) {
    if (rf.type === "json_schema") next.response_format = { type: "json_object" };
    else delete next.response_format;
    return next;
  }
  if ("max_tokens" in next && t.includes("max_tokens")) {
    const v = next.max_tokens;
    delete next.max_tokens;
    if (t.includes("max_completion_tokens")) next.max_completion_tokens = v;
    return next;
  }
  if ("max_completion_tokens" in next && t.includes("max_completion_tokens")) {
    const v = next.max_completion_tokens;
    delete next.max_completion_tokens;
    if (!t.includes("max_tokens")) return next;
    next.max_tokens = v;
    return next;
  }
  return null;
}

async function post(cfg: AiConfig, body: Body, signal?: AbortSignal): Promise<Response> {
  let b = body;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${baseOf(cfg)}/chat/completions`, { method: "POST", headers: headers(cfg), body: JSON.stringify(b), signal });
    } catch (e) {
      throw new AiHttpError(0, `${PROVIDER_INFO[cfg.provider].label} 서버에 연결하지 못했습니다(${e instanceof Error ? e.message : String(e)}). Base URL 을 확인하세요.`);
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => "");
    if (res.status === 400 || res.status === 422) {
      const next = relax(b, text);
      if (next) {
        b = next;
        continue;
      }
    }
    const msg = errorText(text, cfg.apiKey);
    if (/does not support tools|tool.{0,20}not supported|function calling is not/i.test(msg)) {
      throw new AiHttpError(res.status, `이 모델(${cfg.model})은 도구 호출을 지원하지 않습니다. 도구 호출을 지원하는 모델을 고르세요.`);
    }
    throw new AiHttpError(res.status, `${PROVIDER_INFO[cfg.provider].label} 오류(HTTP ${res.status}): ${msg}`);
  }
  throw new AiHttpError(400, "요청 파라미터를 맞추지 못했습니다.");
}

function buildBody(
  cfg: AiConfig,
  o: { messages: OaiMessage[]; maxTokens: number; tools?: OaiTool[]; responseFormat?: OaiResponseFormat; stream?: boolean },
): Body {
  const info = PROVIDER_INFO[cfg.provider];
  const b: Body = { model: cfg.model, messages: o.messages };
  b[info.tokenParam] = maxOutputTokens(cfg.provider, cfg.model, o.maxTokens);
  if (o.tools?.length) b.tools = o.tools;
  if (o.responseFormat) b.response_format = o.responseFormat;
  if (o.stream) {
    b.stream = true;
    b.stream_options = { include_usage: true };
  }
  return b;
}

type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  prompt_cache_hit_tokens?: number;
};

function usageOf(u: RawUsage | null | undefined): Usage {
  if (!u) return {};
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
  return { input_tokens: Math.max(0, (u.prompt_tokens ?? 0) - cached), output_tokens: u.completion_tokens ?? 0, cache_read_input_tokens: cached };
}

/** 응답 한 번(스트리밍 없음) */
export async function oaiComplete(
  cfg: AiConfig,
  o: { messages: OaiMessage[]; maxTokens: number; tools?: OaiTool[]; responseFormat?: OaiResponseFormat; signal?: AbortSignal },
): Promise<OaiResult> {
  const res = await post(cfg, buildBody(cfg, o), o.signal ?? AbortSignal.timeout(280_000));
  const j = await res.json();
  const choice = j.choices?.[0];
  const msg = choice?.message ?? {};
  return {
    model: j.model ?? cfg.model,
    content: typeof msg.content === "string" ? msg.content : "",
    reasoning: msg.reasoning_content ?? "",
    toolCalls: (msg.tool_calls ?? []).map((tc: OaiToolCall, i: number) => ({ ...tc, id: tc.id || `call_${i}`, type: "function" })),
    finishReason: choice?.finish_reason ?? null,
    usage: usageOf(j.usage),
  };
}

/** 스트리밍 응답. 텍스트 조각은 onText, 도구 호출 시작은 onTool 로 알린다 */
export async function oaiStream(
  cfg: AiConfig,
  o: { messages: OaiMessage[]; maxTokens: number; tools?: OaiTool[]; signal?: AbortSignal },
  on: { text?: (delta: string) => void; tool?: (name: string) => void },
): Promise<OaiResult> {
  const res = await post(cfg, buildBody(cfg, { ...o, stream: true }), o.signal ?? AbortSignal.timeout(280_000));
  if (!res.body) throw new AiHttpError(0, "응답 본문이 없습니다.");
  const out: OaiResult = { model: cfg.model, content: "", reasoning: "", toolCalls: [], finishReason: null, usage: {} };
  const calls: OaiToolCall[] = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const handle = (j: {
    model?: string;
    usage?: RawUsage;
    error?: { message?: string } | string;
    choices?: {
      delta?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string }; extra_content?: unknown }[];
      };
      finish_reason?: string | null;
    }[];
  }) => {
    if (j.error) throw new AiHttpError(500, errorText(JSON.stringify({ error: j.error }), cfg.apiKey));
    if (j.model) out.model = j.model;
    if (j.usage) out.usage = usageOf(j.usage);
    const ch = j.choices?.[0];
    if (!ch) return;
    const d = ch.delta ?? {};
    if (d.content) {
      out.content += d.content;
      on.text?.(d.content);
    }
    if (d.reasoning_content) out.reasoning += d.reasoning_content;
    d.tool_calls?.forEach((tc, pos) => {
      const i = tc.index ?? pos;
      let c = calls[i];
      if (!c) {
        c = calls[i] = { id: tc.id || `call_${i}`, type: "function", function: { name: "", arguments: "" } };
      }
      if (tc.id) c.id = tc.id;
      // 이름은 첫 조각에 한 번 온다(제공자에 따라 매 조각 반복하기도 해 처음 것만 쓴다)
      if (tc.function?.name && !c.function.name) {
        c.function.name = tc.function.name;
        on.tool?.(tc.function.name);
      }
      if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
      if (tc.extra_content !== undefined) c.extra_content = tc.extra_content;
    });
    if (ch.finish_reason) out.finishReason = ch.finish_reason;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      handle(j);
    }
  }
  out.toolCalls = calls.filter(Boolean);
  return out;
}

/** 모델 응답에서 JSON 객체 꺼내기(코드 펜스·앞뒤 설명 허용) */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const s = (fenced ?? text).trim();
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error("JSON 을 찾지 못했습니다.");
  }
}
