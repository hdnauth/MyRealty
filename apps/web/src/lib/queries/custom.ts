import "server-only";
import { sql } from "../db";
import { evaluate, ExprError, parse, seriesCodes, toPoints } from "../expr";
import { seriesValues } from "./indicators";

export async function evalExpression(expression: string): Promise<{ points: [string, number][] } | { error: string }> {
  try {
    const node = parse(expression);
    const codes = [...seriesCodes(node)];
    if (codes.length > 8) return { error: "시계열은 8개까지 사용할 수 있습니다." };
    const data = await seriesValues(codes);
    for (const c of codes) if (!data[c]?.length) return { error: `시계열 '${c}' 에 값이 없습니다.` };
    const points = toPoints(evaluate(node, data));
    if (!points.length) return { error: "결과가 비었습니다(시계열 기간이 겹치는지 확인하세요)." };
    return { points };
  } catch (e) {
    if (e instanceof ExprError) return { error: e.message };
    throw e;
  }
}

export async function listCustom(userId: string) {
  return sql<{ id: string; name: string; expression: string }[]>`
    select id, name, expression from custom_indicators where user_id = ${userId} order by created_at`;
}
