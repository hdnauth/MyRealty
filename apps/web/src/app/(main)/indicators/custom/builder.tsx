"use client";

import { useMemo, useState, useTransition } from "react";
import { LineSeriesChart } from "@/components/charts/series-chart";
import { Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { previewAction, saveCustomAction } from "./actions";

type Meta = { code: string; name: string; unit: string | null; source: string; n: number; last: string | null };

const EXAMPLES = [
  { label: "실질 금리", expr: "ecos.mortgage_rate - yoy(ecos.cpi)" },
  { label: "가격 모멘텀 − 금리 부담", expr: "z(yoy(idx.{sgg})) - z(ecos.mortgage_rate)" },
  { label: "지수 / 월부담", expr: "rebase(idx.{sgg}) / rebase(ind.burden.{sgg}) * 100" },
  { label: "거래량 6개월 평균", expr: "ma(vol.{sgg}, 6)" },
];

export function Builder({ catalog, sgg }: { catalog: Meta[]; sgg: string | null }) {
  const [q, setQ] = useState("");
  const [expr, setExpr] = useState(EXAMPLES[0].expr);
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ points: [string, number][] } | { error: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return catalog.filter((c) => !s || c.code.toLowerCase().includes(s) || c.name.toLowerCase().includes(s)).slice(0, 80);
  }, [catalog, q]);

  const run = () => start(async () => setResult(await previewAction(expr)));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="h-fit">
        <CardHeader title="시계열 목록" sub="눌러서 수식에 넣기" />
        <div className="px-4 pb-2"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="코드·이름 검색" /></div>
        <ul className="max-h-[420px] divide-y divide-border overflow-y-auto px-2 pb-2 text-sm">
          {filtered.map((c) => (
            <li key={c.code}>
              <button type="button" onClick={() => setExpr((e) => (e ? `${e} ${c.code}` : c.code))} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
                <span className="block font-mono text-xs text-accent">{c.code}</span>
                <span className="block truncate text-xs text-muted">{c.name} · {c.unit ?? ""} · {c.n}개{c.source === "demo" ? " · 데모" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title="수식" sub="+ − × ÷, 괄호, ma(x,n) lag(x,n) yoy(x) mom(x) z(x) rebase(x) log(x) abs(x)" />
          <div className="space-y-3 px-4 pb-4">
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((e) => (
                <button key={e.label} type="button" onClick={() => setExpr(sgg ? e.expr.replaceAll("{sgg}", sgg) : e.expr)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:border-accent">
                  {e.label}
                </button>
              ))}
            </div>
            <textarea value={expr} onChange={(e) => setExpr(e.target.value)} rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent" />
            <div className="flex flex-wrap items-end gap-2">
              <Button type="button" variant="secondary" onClick={run} disabled={pending}>{pending ? "계산 중…" : "미리보기"}</Button>
              <div className="min-w-40 flex-1"><Field label="이름"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 실질 금리" /></Field></div>
              <Button type="button" disabled={pending} onClick={() => start(async () => { const r = await saveCustomAction(name, expr); setMsg(r.error ?? "저장했습니다."); })}>저장</Button>
            </div>
            {msg ? <p className="text-sm text-muted">{msg}</p> : null}
          </div>
        </Card>
        <Card>
          <CardHeader title="미리보기" />
          <div className="px-2 pb-3">
            {result && "error" in result ? <p className="px-2 pb-2 text-sm text-up">{result.error}</p> : null}
            {result && "points" in result ? <LineSeriesChart lines={[{ name: name || "커스텀 지표", points: result.points }]} fmt="num1" /> : <p className="px-2 pb-2 text-sm text-muted">수식을 입력하고 미리보기를 누르세요.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
