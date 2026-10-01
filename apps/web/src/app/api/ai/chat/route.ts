import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AI_DISABLED_MESSAGE, aiQuotaError, resolveAi } from "@/lib/ai/client";
import { type ChatTurn, runChat } from "@/lib/ai/engine";
import { CHAT_SYSTEM } from "@/lib/ai/prompts";
import { buildTools } from "@/lib/ai/tools";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export const maxDuration = 300;

const Body = z.object({ conversationId: z.string().uuid().optional(), message: z.string().min(1).max(4000) });

type Stored = { text: string; tools?: { name: string; input: unknown }[] };

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { cfg, problem } = await resolveAi(user.id);
  if (!cfg) return NextResponse.json({ error: problem ?? AI_DISABLED_MESSAGE }, { status: 503 });
  const quota = await aiQuotaError(user.id, cfg);
  if (quota) return NextResponse.json({ error: quota }, { status: 429 });
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
  const messages: ChatTurn[] = history
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
      // 중간에 실패해도 받은 데까지는 남기도록 스트림 조각을 따로 모은다
      let text = "";
      let streamed = "";
      let toolLog: { name: string; input: unknown }[] = [];
      try {
        ({ text, toolLog } = await runChat({
          cfg,
          userId: user.id,
          system: CHAT_SYSTEM,
          messages,
          tools,
          on: {
            text: (delta) => {
              streamed += delta;
              send("text", { delta });
            },
            tool: (name) => send("tool", { name }),
            error: (message) => send("error", { message }),
          },
        }));
      } catch (e) {
        console.error("[ai/chat]", e);
        text = streamed;
        // 본인 키 설정 오류(인증·모델명 등)는 고칠 수 있게 그대로 보여 준다
        send("error", { message: cfg.ownKey && e instanceof Error ? e.message : "AI 응답 중 오류가 발생했습니다." });
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
