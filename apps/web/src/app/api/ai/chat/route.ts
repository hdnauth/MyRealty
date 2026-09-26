import type Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { anthropic, budgetOk, effortConfig, fallbackParams, MODEL, recordUsage } from "@/lib/ai/client";
import { CHAT_SYSTEM, todayLine } from "@/lib/ai/prompts";
import { buildTools } from "@/lib/ai/tools";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export const maxDuration = 300;

const Body = z.object({ conversationId: z.string().uuid().optional(), message: z.string().min(1).max(4000) });

type Stored = { text: string; tools?: { name: string; input: unknown }[] };

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY 가 설정되지 않았습니다." }, { status: 503 });
  if (!(await budgetOk())) return NextResponse.json({ error: "이번 달 AI 예산(AI_MONTHLY_BUDGET_USD)을 모두 사용했습니다." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { message } = parsed.data;

  let convId = parsed.data.conversationId;
  if (convId) {
    const own = await sql`select 1 from ai_conversations where id = ${convId} and user_id = ${user.id}`;
    if (!own.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  } else {
    const [c] = await sql<{ id: string }[]>`
      insert into ai_conversations (user_id, title) values (${user.id}, ${message.slice(0, 60)}) returning id`;
    convId = c.id;
  }

  // 이전 대화는 최종 텍스트만 재전송(도구 결과·사고 블록은 다시 조회하게 한다)
  const history = await sql<{ role: "user" | "assistant"; content: Stored }[]>`
    select role, content from ai_messages where conversation_id = ${convId} order by id desc limit 20`;
  const messages: Anthropic.Beta.BetaMessageParam[] = history
    .reverse()
    .filter((m) => m.content.text)
    .map((m) => ({ role: m.role, content: m.content.text }));
  messages.push({ role: "user", content: message });
  await sql`insert into ai_messages (conversation_id, role, content) values (${convId}, 'user', ${sql.json({ text: message })})`;

  const tools = buildTools(user.id);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("meta", { conversationId: convId });
      let text = "";
      const toolLog: { name: string; input: unknown }[] = [];
      try {
        const runner = anthropic().beta.messages.toolRunner({
          model: MODEL,
          max_tokens: 16000,
          max_iterations: 8,
          system: [
            { type: "text", text: CHAT_SYSTEM, cache_control: { type: "ephemeral" } },
            { type: "text", text: todayLine() },
          ],
          tools,
          messages,
          output_config: effortConfig("medium"),
          ...fallbackParams(),
          stream: true,
        });
        for await (const ms of runner) {
          let iterText = "";
          for await (const ev of ms) {
            if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
              send("tool", { name: ev.content_block.name });
            } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
              iterText += ev.delta.text;
              send("text", { delta: ev.delta.text });
            }
          }
          const msg = await ms.finalMessage();
          await recordUsage("chat", msg.model, msg.usage);
          for (const b of msg.content) if (b.type === "tool_use") toolLog.push({ name: b.name, input: b.input });
          if (iterText) {
            text += (text ? "\n\n" : "") + iterText;
            send("text", { delta: "\n\n" });
          }
          if (msg.stop_reason === "refusal") {
            send("error", { message: "이 요청은 처리할 수 없습니다." });
            break;
          }
          if (msg.stop_reason === "max_tokens" && msg.content.some((b) => b.type === "tool_use")) {
            send("error", { message: "응답이 너무 길어 중단되었습니다. 질문을 나눠 주세요." });
            break;
          }
        }
      } catch (e) {
        console.error("[ai/chat]", e);
        send("error", { message: "AI 응답 중 오류가 발생했습니다." });
      }
      await sql`insert into ai_messages (conversation_id, role, content)
                values (${convId}, 'assistant', ${sql.json({ text: text.trim(), tools: toolLog } as never)})`;
      await sql`update ai_conversations set updated_at = now() where id = ${convId}`;
      send("done", { conversationId: convId });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
