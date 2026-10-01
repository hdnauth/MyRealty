import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { type AiConfig, anthropic, effortConfig, fallbackParams, recordUsage, textOf } from "./client";
import { type OaiMessage, type OaiResponseFormat, type OaiTool, extractJson, oaiComplete, oaiStream } from "./openai-compat";
import { PROVIDER_INFO } from "./providers";
import { todayLine } from "./prompts";

/*
 * 제공자 중립 AI 호출. Anthropic 은 기존 SDK 기능(프롬프트 캐시·effort·서버 폴백·구조화 출력)을 그대로 쓰고,
 * 나머지(OpenAI 호환)는 같은 입력을 Chat Completions 형식으로 바꿔 보낸다.
 */

type Effort = "low" | "medium" | "high";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolDef = { name: string; description: string; inputSchema: z.ZodObject<any>; run: (input: any) => Promise<string> };

/** 도구 정의(입력 타입 추론용) */
export function defineTool<S extends z.ZodObject>(t: { name: string; description: string; inputSchema: S; run: (input: z.infer<S>) => Promise<string> }): ToolDef {
  return t;
}

/** zod → JSON Schema(제공자 공통으로 받아들이는 형태로 정리) */
export function jsonSchemaOf(schema: z.ZodType, provider: AiConfig["provider"], io: "input" | "output" = "output"): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  // Gemini 호환 계층은 additionalProperties 를 거부하는 경우가 있어 뺀다
  if (provider === "gemini") {
    const strip = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(strip);
      else if (v && typeof v === "object") {
        delete (v as Record<string, unknown>).additionalProperties;
        Object.values(v).forEach(strip);
      }
    };
    strip(js);
  }
  return js;
}

const systemText = (system: string) => `${system}\n\n${todayLine()}`;

/** 구조화 출력(분석 카드·비교) */
export async function generateObject<S extends z.ZodType>(o: {
  cfg: AiConfig;
  userId: string;
  purpose: string;
  system: string;
  prompt: string;
  schema: S;
  schemaName: string;
  maxTokens?: number;
  effort?: Effort;
}): Promise<{ data: z.infer<S>; model: string }> {
  const { cfg } = o;
  const maxTokens = o.maxTokens ?? 8000;
  if (cfg.provider === "anthropic") {
    const msg = await anthropic(cfg).beta.messages.parse({
      model: cfg.model,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: o.system, cache_control: { type: "ephemeral" } },
        { type: "text", text: todayLine() },
      ],
      messages: [{ role: "user", content: o.prompt }],
      output_config: { format: betaZodOutputFormat(o.schema as never), ...effortConfig(o.effort ?? "high", cfg.model) },
      ...fallbackParams(cfg.model),
    });
    await recordUsage(o.purpose, msg.model, msg.usage, o.userId, cfg);
    if (msg.stop_reason === "refusal" || !msg.parsed_output) throw new Error("결과를 생성하지 못했습니다.");
    return { data: msg.parsed_output as z.infer<S>, model: msg.model };
  }

  const schema = jsonSchemaOf(o.schema, cfg.provider);
  const responseFormat: OaiResponseFormat = PROVIDER_INFO[cfg.provider].jsonSchema
    ? { type: "json_schema", json_schema: { name: o.schemaName, schema, strict: false } }
    : { type: "json_object" };
  const messages: OaiMessage[] = [
    {
      role: "system",
      content: `${systemText(o.system)}\n\n출력 형식: 아래 JSON Schema 를 따르는 JSON 객체 하나만 출력하세요(설명·코드 펜스 없이). 문장은 한국어로 씁니다.\n${JSON.stringify(schema)}`,
    },
    { role: "user", content: o.prompt },
  ];
  // 형식이 어긋나면 오류를 알려 주고 한 번 더 받는다
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await oaiComplete(cfg, { messages, maxTokens, responseFormat });
    await recordUsage(o.purpose, r.model, r.usage, o.userId, cfg);
    let problem: string;
    try {
      const parsed = o.schema.safeParse(extractJson(r.content));
      if (parsed.success) return { data: parsed.data, model: r.model };
      problem = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
    if (r.finishReason === "length") throw new Error("응답이 출력 한도에서 잘렸습니다. 출력이 더 긴 모델을 고르세요.");
    messages.push({ role: "assistant", content: r.content }, { role: "user", content: `JSON 이 스키마와 맞지 않습니다(${problem}). 스키마에 맞는 JSON 객체만 다시 출력하세요.` });
  }
  throw new Error("모델이 형식에 맞는 결과를 내지 못했습니다. 다른 모델을 골라 보세요.");
}

/** 자유 텍스트(리포트 Markdown) */
export async function generateText(o: { cfg: AiConfig; userId: string; purpose: string; system: string; prompt: string; maxTokens?: number; effort?: Effort }): Promise<{ text: string; model: string }> {
  const { cfg } = o;
  const maxTokens = o.maxTokens ?? 8000;
  if (cfg.provider === "anthropic") {
    const msg = await anthropic(cfg).beta.messages.create({
      model: cfg.model,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: o.system, cache_control: { type: "ephemeral" } },
        { type: "text", text: todayLine() },
      ],
      messages: [{ role: "user", content: o.prompt }],
      output_config: effortConfig(o.effort ?? "medium", cfg.model),
      ...fallbackParams(cfg.model),
    });
    await recordUsage(o.purpose, msg.model, msg.usage, o.userId, cfg);
    if (msg.stop_reason === "refusal") throw new Error("이 요청은 처리할 수 없습니다.");
    return { text: textOf(msg.content).trim(), model: msg.model };
  }
  const r = await oaiComplete(cfg, {
    messages: [
      { role: "system", content: systemText(o.system) },
      { role: "user", content: o.prompt },
    ],
    maxTokens,
  });
  await recordUsage(o.purpose, r.model, r.usage, o.userId, cfg);
  return { text: r.content.trim(), model: r.model };
}

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type ChatEvents = { text: (delta: string) => void; tool: (name: string) => void; error: (message: string) => void };

/**
 * 도구를 쓰는 대화 한 턴. 반복(도구 호출 → 결과 → 다시 생성)마다 텍스트를 이어 붙인다.
 * 반환: 최종 텍스트와 호출한 도구 기록
 */
export async function runChat(o: {
  cfg: AiConfig;
  userId: string;
  system: string;
  messages: ChatTurn[];
  tools: ToolDef[];
  on: ChatEvents;
  maxIterations?: number;
}): Promise<{ text: string; toolLog: { name: string; input: unknown }[] }> {
  const { cfg, on } = o;
  const maxIterations = o.maxIterations ?? 8;
  let text = "";
  const toolLog: { name: string; input: unknown }[] = [];
  const addIter = (iterText: string) => {
    if (!iterText) return;
    text += (text ? "\n\n" : "") + iterText;
    on.text("\n\n");
  };

  if (cfg.provider === "anthropic") {
    const runner = anthropic(cfg).beta.messages.toolRunner({
      model: cfg.model,
      max_tokens: 16000,
      max_iterations: maxIterations,
      system: [
        { type: "text", text: o.system, cache_control: { type: "ephemeral" } },
        { type: "text", text: todayLine() },
      ],
      tools: o.tools.map((t) => betaZodTool(t)),
      messages: o.messages as Anthropic.Beta.BetaMessageParam[],
      output_config: effortConfig("medium", cfg.model),
      ...fallbackParams(cfg.model),
      stream: true,
    });
    for await (const ms of runner) {
      let iterText = "";
      for await (const ev of ms) {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          on.tool(ev.content_block.name);
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          iterText += ev.delta.text;
          on.text(ev.delta.text);
        }
      }
      const msg = await ms.finalMessage();
      await recordUsage("chat", msg.model, msg.usage, o.userId, cfg);
      for (const b of msg.content) if (b.type === "tool_use") toolLog.push({ name: b.name, input: b.input });
      addIter(iterText);
      if (msg.stop_reason === "refusal") {
        on.error("이 요청은 처리할 수 없습니다.");
        break;
      }
      if (msg.stop_reason === "max_tokens" && msg.content.some((b) => b.type === "tool_use")) {
        on.error("응답이 너무 길어 중단되었습니다. 질문을 나눠 주세요.");
        break;
      }
    }
    return { text, toolLog };
  }

  // OpenAI 호환: 도구 호출 루프를 직접 돈다
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  const oaiTools: OaiTool[] = o.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: jsonSchemaOf(t.inputSchema, cfg.provider, "input") },
  }));
  const echoReasoning = PROVIDER_INFO[cfg.provider].echoReasoning;
  const messages: OaiMessage[] = [{ role: "system", content: systemText(o.system) }, ...o.messages];
  for (let i = 0; i < maxIterations; i++) {
    const last = i === maxIterations - 1;
    const r = await oaiStream(cfg, { messages, maxTokens: 16000, tools: last ? undefined : oaiTools }, { text: on.text, tool: on.tool });
    await recordUsage("chat", r.model, r.usage, o.userId, cfg);
    addIter(r.content);
    if (!r.toolCalls.length) {
      if (r.finishReason === "length") on.error("응답이 출력 한도에서 잘렸습니다.");
      break;
    }
    messages.push({
      role: "assistant",
      content: r.content || null,
      tool_calls: r.toolCalls,
      ...(echoReasoning && r.reasoning ? { reasoning_content: r.reasoning } : {}),
    });
    for (const tc of r.toolCalls) {
      const tool = byName.get(tc.function.name);
      let input: unknown = {};
      let result: string;
      try {
        if (!tool) throw new Error(`알 수 없는 도구: ${tc.function.name}`);
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        result = await tool.run(tool.inputSchema.parse(input ?? {}));
      } catch (e) {
        result = `오류: ${e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : String(e)}`;
      }
      toolLog.push({ name: tc.function.name, input });
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }
  return { text, toolLog };
}

/** 연결 확인: 아주 짧은 응답 한 번 */
export async function pingModel(cfg: AiConfig): Promise<string> {
  if (cfg.provider === "anthropic") {
    const msg = await anthropic(cfg).messages.create({ model: cfg.model, max_tokens: 16, messages: [{ role: "user", content: "ping 에 'pong' 한 단어로 답하세요." }] });
    return textOf(msg.content).trim() || "(빈 응답)";
  }
  const r = await oaiComplete(cfg, { messages: [{ role: "user", content: "ping 에 'pong' 한 단어로 답하세요." }], maxTokens: 512, signal: AbortSignal.timeout(60_000) });
  return r.content.trim() || (r.reasoning ? "(사고 응답만 받음)" : "(빈 응답)");
}
