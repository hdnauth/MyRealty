"use client";

import clsx from "clsx";
import { Search } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import type { AddressCandidate } from "@/app/api/address/route";
import { DetailFields } from "@/components/items/detail-fields";
import { Button, Card, Field, Input, Notice } from "@/components/ui";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/property";
import { createItemAction, type ItemFormState } from "../actions";

type ComplexInfo = { complexes: { id: number; name: string; build_year: number | null; households: number | null }[]; areas: { area: number; n: number }[] };

function guessType(c: AddressCandidate): PropertyType {
  if (c.complexType && c.complexType in PROPERTY_TYPES) return c.complexType as PropertyType;
  if (c.isApartment) return "apt";
  if (c.mountain) return "forest";
  if (!c.buildingName) return "land";
  return "house";
}

export function NewItemForm() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AddressCandidate[]>([]);
  const [meta, setMeta] = useState<{ jusoEnabled?: boolean; jusoError?: string | null }>({});
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<AddressCandidate | null>(null);
  const [type, setType] = useState<PropertyType>("apt");
  const [complexState, setComplexState] = useState<{ key: string; data: ComplexInfo } | null>(null);
  const [state, action, pending] = useActionState<ItemFormState, FormData>(createItemAction, {});

  useEffect(() => {
    if (q.trim().length < 2 || picked) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/address?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        const data = await r.json();
        setResults(data.results ?? []);
        setMeta({ jusoEnabled: data.jusoEnabled, jusoError: data.jusoError });
      } catch {
        /* 입력 중 취소 */
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, picked]);

  // 선택한 주소·유형에 해당하는 단지 조회. 응답은 요청 키와 함께 저장해 오래된 응답을 무시한다.
  const complexKey =
    picked && PROPERTY_TYPES[type].hasComplex
      ? new URLSearchParams(
          picked.complexId
            ? { id: String(picked.complexId) }
            : { sgg: picked.sggCd, umd: picked.emdName ?? "", jibun: picked.jibun ?? "", type },
        ).toString()
      : null;
  useEffect(() => {
    if (!complexKey) return;
    let alive = true;
    fetch(`/api/complexes?${complexKey}`)
      .then((r) => r.json())
      .then((data: ComplexInfo) => alive && setComplexState({ key: complexKey, data }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [complexKey]);
  const complex = complexKey && complexState?.key === complexKey ? complexState.data : null;

  const matched = complex?.complexes[0];
  const isLand = type === "land" || type === "forest";

  return (
    <form action={action} className="space-y-4">
      <Card className="p-4">
        <Field label="주소 · 단지명 · 지번 검색">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <Input
              value={picked ? picked.roadAddr ?? picked.jibunAddr : q}
              onChange={(e) => {
                setPicked(null);
                setQ(e.target.value);
              }}
              placeholder="예) 잠실엘스, 올림픽로 99, 양서면 목왕리 산 12"
              className="pl-10"
              autoFocus
            />
          </div>
        </Field>
        {meta.jusoEnabled === false && !picked ? (
          <p className="mt-2 text-xs text-muted">JUSO_KEY 가 없어 수집된 단지명만 검색됩니다.</p>
        ) : null}
        {meta.jusoError && !picked ? <p className="mt-2 text-xs text-warn">주소 API 오류: {meta.jusoError}</p> : null}
        {!picked && results.length > 0 ? (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="w-full px-3 py-2.5 text-left hover:bg-surface-2"
                  onClick={() => {
                    setPicked(r);
                    setType(guessType(r));
                  }}
                >
                  <div className="text-sm font-medium">
                    {r.buildingName ? `${r.buildingName} · ` : ""}
                    {r.roadAddr ?? r.jibunAddr}
                  </div>
                  <div className="text-xs text-muted">
                    {r.source === "local" ? "수집된 단지 · " : "지번 "}
                    {r.jibunAddr}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {!picked && loading ? <p className="mt-2 text-xs text-muted">검색 중…</p> : null}
      </Card>

      {picked ? (
        <Card className="space-y-4 p-4">
          <input type="hidden" name="sgg_cd" value={picked.sggCd} />
          <input type="hidden" name="lawd_cd" value={picked.lawdCd ?? ""} />
          <input type="hidden" name="road_address" value={picked.roadAddr ?? ""} />
          <input type="hidden" name="jibun_address" value={picked.jibunAddr} />
          <input type="hidden" name="building_name" value={matched?.name ?? picked.buildingName ?? ""} />
          <input type="hidden" name="sido_name" value={picked.sidoName ?? ""} />
          <input type="hidden" name="sgg_name" value={picked.sggName ?? ""} />
          <input type="hidden" name="emd_name" value={picked.emdName ?? ""} />
          <input type="hidden" name="bonbun" value={picked.bonbun ?? ""} />
          <input type="hidden" name="bubun" value={picked.bubun ?? ""} />
          <input type="hidden" name="mountain" value={picked.mountain ? "1" : "0"} />
          <input type="hidden" name="complex_id" value={matched?.id ?? ""} />

          <Field label="유형">
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
              {(Object.keys(PROPERTY_TYPES) as PropertyType[]).map((k) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setType(k)}
                  className={clsx(
                    "rounded-lg border px-2 py-2 text-xs font-medium",
                    type === k ? "border-accent bg-accent-soft text-accent" : "border-border text-muted",
                  )}
                >
                  {PROPERTY_TYPES[k].label}
                </button>
              ))}
            </div>
            <input type="hidden" name="property_type" value={type} />
          </Field>

          {PROPERTY_TYPES[type].hasComplex ? (
            matched ? (
              <Notice>
                단지 매칭: <b className="text-text">{matched.name}</b>
                {matched.build_year ? ` · ${matched.build_year}년` : ""}
                {matched.households ? ` · ${matched.households.toLocaleString()}세대` : ""}
              </Notice>
            ) : (
              <Notice tone="warn">아직 이 주소의 실거래가 수집되지 않았습니다. 등록 후 다음 수집 때 자동으로 연결됩니다.</Notice>
            )
          ) : null}
          {type === "forest" || type === "land" ? (
            <Notice>토지·임야 실거래는 지번 일부가 공개되지 않아 같은 읍면동의 유사 면적 거래와 비교합니다.</Notice>
          ) : null}

          <DetailFields isLand={isLand} areaOptions={complex?.areas} d={{ label: matched?.name ?? picked.buildingName ?? "" }} />

          {state.error ? <p className="text-sm text-up">{state.error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPicked(null)}>
              다시 검색
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "등록 중…" : "등록"}
            </Button>
          </div>
        </Card>
      ) : null}
    </form>
  );
}
