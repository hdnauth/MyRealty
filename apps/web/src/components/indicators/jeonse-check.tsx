"use client";

import { useState } from "react";
import { Badge, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { formatManwon, formatPct } from "@/lib/format";
import { jeonseRisk } from "@/lib/finance";

export type JeonseItemOption = { id: string; label: string; market: number | null; official: number | null };

/** 깡통전세 위험 점검: 보증금·선순위 채권 vs 시세·공시가격 126% */
export function JeonseCheck({ items }: { items: JeonseItemOption[] }) {
  const [sel, setSel] = useState(items[0]?.id ?? "");
  const it = items.find((i) => i.id === sel);
  const [market, setMarket] = useState(it?.market ? String(Math.round(it.market)) : "");
  const [official, setOfficial] = useState(it?.official ? String(Math.round(it.official)) : "");
  const [deposit, setDeposit] = useState("");
  const [senior, setSenior] = useState("0");
  const r = jeonseRisk({
    deposit: Number(deposit) || 0,
    marketPrice: Number(market) || null,
    officialPrice: Number(official) || null,
    seniorDebt: Number(senior) || 0,
  });
  const tone = r.level === "위험" ? "up" : r.level === "주의" ? "warn" : r.level === "안전" ? "ok" : "neutral";

  return (
    <Card>
      <CardHeader title="깡통전세 위험 점검" sub="빌라·오피스텔 전세 계약 전 확인 · 공시가격 126%는 HUG 전세보증 가입 기준(현행 기준 확인)" />
      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-5">
        {items.length ? (
          <Field label="내 물건에서 불러오기">
            <Select
              value={sel}
              onChange={(e) => {
                setSel(e.target.value);
                const n = items.find((i) => i.id === e.target.value);
                setMarket(n?.market ? String(Math.round(n.market)) : "");
                setOfficial(n?.official ? String(Math.round(n.official)) : "");
              }}
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.label}</option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="시세(만원)"><Input inputMode="numeric" value={market} onChange={(e) => setMarket(e.target.value)} /></Field>
        <Field label="공시가격(만원)"><Input inputMode="numeric" value={official} onChange={(e) => setOfficial(e.target.value)} /></Field>
        <Field label="전세 보증금(만원)"><Input inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="예) 25000" /></Field>
        <Field label="선순위 채권(만원)" hint="등기부 을구 근저당 등"><Input inputMode="numeric" value={senior} onChange={(e) => setSenior(e.target.value)} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-4 p-4 text-sm">
        <Badge tone={tone} className="px-2.5 py-1 text-sm">{r.level}</Badge>
        <span>부채비율(보증금+선순위 / 시세) <b className="tabular">{r.ratio !== null ? formatPct(r.ratio, 1, false) : "-"}</b></span>
        <span>
          보증 가입 한도(공시×126%) <b className="tabular">{formatManwon(r.cap)}</b>
          {r.overCap !== null && r.overCap > 0 ? <span className="ml-1 text-up">({formatManwon(r.overCap)} 초과)</span> : null}
        </span>
      </div>
      <p className="px-4 pb-4 text-xs text-muted">기준: 부채비율 80% 이상 주의, 90% 이상 또는 보증 한도 초과 시 위험. 실제 계약 전 등기부등본·선순위 임차인·세금 체납 여부를 반드시 확인하세요.</p>
    </Card>
  );
}
