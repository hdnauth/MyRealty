import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
// 사용 기록·Anthropic 클라이언트는 DB·네트워크를 쓰므로 가짜로
vi.mock("../ai/client", () => ({
  recordUsage: vi.fn(async () => {}),
  anthropic: vi.fn(),
  effortConfig: () => ({}),
  fallbackParams: () => ({}),
  textOf: () => "",
}));

const { oaiStream, extractJson } = await import("../ai/openai-compat");
const { defineTool, generateObject, runChat } = await import("../ai/engine");
type Cfg = Parameters<typeof oaiStream>[0];

const cfg = (provider: Cfg["provider"], model = "m"): Cfg => ({ provider, model, apiKey: "sk-test-123456", baseUrl: "https://example.test/v1", ownKey: true });

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  // 조각 경계가 줄 중간에 걸려도 이어 붙이는지 보려고 7바이트씩 나눠 보낸다
  const bytes = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; body: Record<string, unknown> };
function stubFetch(responses: Response[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const r = responses.shift();
      if (!r) throw new Error("응답 없음");
      return r;
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAI 호환 스트리밍", () => {
  it("텍스트·나뉜 도구 인자·extra_content·사용량을 모은다", async () => {
    stubFetch([
      sse([
        { model: "gemini-x", choices: [{ delta: { content: "안녕" } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "get_location", arguments: '{"item_' }, extra_content: { google: { thought_signature: "sig" } } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'id":"abc"}' } }] }, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } } },
      ]),
    ]);
    const texts: string[] = [];
    const tools: string[] = [];
    const r = await oaiStream(cfg("gemini"), { messages: [{ role: "user", content: "hi" }], maxTokens: 100 }, { text: (d) => texts.push(d), tool: (n) => tools.push(n) });
    expect(r.content).toBe("안녕");
    expect(texts.join("")).toBe("안녕");
    expect(tools).toEqual(["get_location"]);
    expect(r.toolCalls).toEqual([{ id: "c1", type: "function", function: { name: "get_location", arguments: '{"item_id":"abc"}' }, extra_content: { google: { thought_signature: "sig" } } }]);
    expect(r.usage).toEqual({ input_tokens: 60, output_tokens: 20, cache_read_input_tokens: 40 });
    expect(r.model).toBe("gemini-x");
  });

  it("400 이 지목한 파라미터를 바꿔 다시 보낸다(max_tokens → max_completion_tokens)", async () => {
    const calls = stubFetch([
      json({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }, 400),
      sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]),
    ]);
    const r = await oaiStream(cfg("gemini"), { messages: [{ role: "user", content: "hi" }], maxTokens: 100 }, {});
    expect(r.content).toBe("ok");
    expect(calls[0].body.max_tokens).toBe(100);
    expect(calls[1].body.max_tokens).toBeUndefined();
    expect(calls[1].body.max_completion_tokens).toBe(100);
    expect(calls[0].url).toBe("https://example.test/v1/chat/completions");
  });

  it("인증 오류 메시지에 키를 노출하지 않는다", async () => {
    stubFetch([json({ error: { message: "Incorrect API key provided: sk-test-123456" } }, 401)]);
    await expect(oaiStream(cfg("openai"), { messages: [{ role: "user", content: "hi" }], maxTokens: 10 }, {})).rejects.toThrow(/\*\*\*/);
  });

  it("DeepSeek 출력 상한을 모델에 맞춘다", async () => {
    const calls = stubFetch([sse([{ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] }])]);
    await oaiStream(cfg("deepseek", "deepseek-chat"), { messages: [{ role: "user", content: "hi" }], maxTokens: 16000 }, {});
    expect(calls[0].body.max_tokens).toBe(8192);
  });
});

describe("도구 호출 대화", () => {
  it("도구를 실행해 결과를 돌려주고 최종 답을 받는다(DeepSeek 은 reasoning_content 를 되돌린다)", async () => {
    const calls = stubFetch([
      sse([
        { choices: [{ delta: { reasoning_content: "생각" } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "add", arguments: '{"a":2,"b":3}' } }] }, finish_reason: "tool_calls" }] },
      ]),
      sse([{ choices: [{ delta: { content: "합은 5입니다." }, finish_reason: "stop" }] }]),
    ]);
    const add = defineTool({
      name: "add",
      description: "두 수 더하기",
      inputSchema: z.object({ a: z.number(), b: z.number(), scale: z.number().default(1) }),
      run: async ({ a, b, scale }) => String((a + b) * scale),
    });
    const events: string[] = [];
    const r = await runChat({
      cfg: cfg("deepseek", "deepseek-reasoner"),
      userId: "u",
      system: "sys",
      messages: [{ role: "user", content: "2+3?" }],
      tools: [add],
      on: { text: (d) => events.push(`t:${d}`), tool: (n) => events.push(`tool:${n}`), error: (m) => events.push(`e:${m}`) },
    });
    expect(r.text).toBe("합은 5입니다.");
    expect(r.toolLog).toEqual([{ name: "add", input: { a: 2, b: 3 } }]);
    expect(events).toContain("tool:add");
    // 도구 정의: 기본값이 있는 인자는 필수가 아니다
    const fn = (calls[0].body.tools as { function: { parameters: { required?: string[] } } }[])[0].function;
    expect(fn.parameters.required).toEqual(["a", "b"]);
    const second = calls[1].body.messages as Record<string, unknown>[];
    expect(second[0]).toMatchObject({ role: "system" });
    expect(second.at(-2)).toMatchObject({ role: "assistant", reasoning_content: "생각", tool_calls: [{ id: "t1" }] });
    expect(second.at(-1)).toEqual({ role: "tool", tool_call_id: "t1", content: "5" });
  });

  it("도구 오류는 대화를 끊지 않고 모델에게 알린다", async () => {
    const calls = stubFetch([
      sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "add", arguments: '{"a":"x"}' } }] }, finish_reason: "tool_calls" }] }]),
      sse([{ choices: [{ delta: { content: "다시 확인해 주세요." }, finish_reason: "stop" }] }]),
    ]);
    const add = defineTool({ name: "add", description: "", inputSchema: z.object({ a: z.number() }), run: async ({ a }) => String(a) });
    await runChat({ cfg: cfg("openai"), userId: "u", system: "s", messages: [{ role: "user", content: "?" }], tools: [add], on: { text: () => {}, tool: () => {}, error: () => {} } });
    const last = (calls[1].body.messages as { role: string; content: string }[]).at(-1)!;
    expect(last.role).toBe("tool");
    expect(last.content).toMatch(/^오류:/);
  });
});

describe("구조화 출력", () => {
  const Card = z.object({ one_liner: z.string(), risks: z.array(z.string()) });

  it("json_object 제공자: 코드 펜스를 벗기고 스키마가 틀리면 한 번 더 요청한다", async () => {
    const calls = stubFetch([
      json({ model: "mimo-v2.6-pro", choices: [{ message: { content: '```json\n{"one_liner":"요약"}\n```' }, finish_reason: "stop" }] }),
      json({ model: "mimo-v2.6-pro", choices: [{ message: { content: '{"one_liner":"요약","risks":["금리"]}' }, finish_reason: "stop" }] }),
    ]);
    const r = await generateObject({ cfg: cfg("mimo"), userId: "u", purpose: "t", system: "s", prompt: "p", schema: Card, schemaName: "card" });
    expect(r.data).toEqual({ one_liner: "요약", risks: ["금리"] });
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
    expect(calls[0].body.max_completion_tokens).toBe(8000);
    expect((calls[1].body.messages as { content: string }[]).at(-1)!.content).toMatch(/risks/);
  });

  it("json_schema 제공자는 스키마를 보내고, Gemini 에는 additionalProperties 를 빼서 보낸다", async () => {
    const calls = stubFetch([json({ choices: [{ message: { content: '{"one_liner":"a","risks":[]}' }, finish_reason: "stop" }] })]);
    await generateObject({ cfg: cfg("gemini"), userId: "u", purpose: "t", system: "s", prompt: "p", schema: Card, schemaName: "card" });
    const rf = calls[0].body.response_format as { type: string; json_schema: { schema: Record<string, unknown> } };
    expect(rf.type).toBe("json_schema");
    expect(JSON.stringify(rf.json_schema.schema)).not.toContain("additionalProperties");
  });

  it("extractJson 은 앞뒤 설명이 붙어도 객체를 꺼낸다", () => {
    expect(extractJson('결과입니다: {"a": 1} 끝')).toEqual({ a: 1 });
  });
});
