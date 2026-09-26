"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, Field, Input } from "@/components/ui";
import { formatManwon } from "@/lib/format";
import { scenario } from "@/lib/finance";

/** 금리·가격·LTV 시나리오: 월 상환액·DSR·월부담 */
export function Simulator({ defaultPrice, defaultRate, defaultIncome }: { defaultPrice: number; defaultRate: number; defaultIncome: number }) {
  const [price, setPrice] = useState(String(Math.round(defaultPrice)));
  const [ltv, setLtv] = useState("50");
  const [rate, setRate] = useState(defaultRate.toFixed(2));
  const [years, setYears] = useState("30");
  const [income, setIncome] = useState(String(Math.round(defaultIncome)));
  const base = useMemo(
    () => ({ price: Number(price) || 0, ltv: (Number(ltv) || 0) / 100, rate: Number(rate) || 0, years: Number(years) || 30, incomeAnnual: Number(income) || 1 }),
    [price, ltv, rate, years, income],
  );
  const rows = [-1, -0.5, 0, 0.5, 1, 2].map((d) => ({ d, s: scenario({ ...base, rate: Math.max(0, base.rate + d) }) }));
  const priceRows = [-0.2, -0.1, 0, 0.1, 0.2].map((d) => ({ d, s: scenario({ ...base, price: base.price * (1 + d) }) }));
  const cur = scenario(base);
  const dsrTone = (v: number) => (v >= 0.4 ? "text-up font-semibold" : v >= 0.3 ? "text-warn" : "");

  return (
    <Card>
      <CardHeader title="대출 시나리오" sub="원리금균등 · DSR = 연 원리금 / 연소득 (규제 한도 40% 참고)" />
      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-5">
        <Field label="매매가(만원)"><Input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="LTV(%)"><Input inputMode="numeric" value={ltv} onChange={(e) => setLtv(e.target.value)} /></Field>
        <Field label="금리(%)"><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <Field label="기간(년)"><Input inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} /></Field>
        <Field label="연소득(만원)"><Input inputMode="numeric" value={income} onChange={(e) => setIncome(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <Tile k="대출금" v={formatManwon(cur.loan)} />
        <Tile k="필요 자기자본" v={formatManwon(cur.equity)} />
        <Tile k="월 상환액" v={`${Math.round(cur.monthly).toLocaleString()}만원`} />
        <Tile k="DSR" v={`${(cur.dsr * 100).toFixed(1)}%`} tone={dsrTone(cur.dsr)} />
      </div>
      <div className="grid grid-cols-1 gap-4 px-4 pb-4 md:grid-cols-2">
        <SensTable title="금리 변화" rows={rows.map((r) => ({ label: `${r.d > 0 ? "+" : ""}${r.d}%p → ${(base.rate + r.d).toFixed(2)}%`, s: r.s, cur: r.d === 0 }))} dsrTone={dsrTone} />
        <SensTable title="가격 변화" rows={priceRows.map((r) => ({ label: `${r.d > 0 ? "+" : ""}${r.d * 100}% → ${formatManwon(base.price * (1 + r.d), { short: true })}`, s: r.s, cur: r.d === 0 }))} dsrTone={dsrTone} />
      </div>
    </Card>
  );
}

function Tile({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="text-xs text-muted">{k}</div>
      <div className={`tabular mt-0.5 font-semibold ${tone ?? ""}`}>{v}</div>
    </div>
  );
}

function SensTable({ title, rows, dsrTone }: { title: string; rows: { label: string; s: ReturnType<typeof scenario>; cur: boolean }[]; dsrTone: (v: number) => string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{title}</div>
      <table className="w-full whitespace-nowrap text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 font-medium">시나리오</th>
            <th className="py-1 text-right font-medium">월 상환</th>
            <th className="py-1 text-right font-medium">DSR</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => (
            <tr key={r.label} className={`border-t border-border/60 ${r.cur ? "font-semibold" : ""}`}>
              <td className="py-1">{r.label}</td>
              <td className="py-1 text-right">{Math.round(r.s.monthly).toLocaleString()}만</td>
              <td className={`py-1 text-right ${dsrTone(r.s.dsr)}`}>{(r.s.dsr * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
