"use client";

import clsx from "clsx";
import { Loader2, Search } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import type { AddressCandidate } from "@/app/api/address/route";
import type { InspectResult } from "@/app/api/address/inspect/route";
import { DetailFields } from "@/components/items/detail-fields";
import { Badge, Button, Card, Field, Input, Notice } from "@/components/ui";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/property";
import { createItemAction, type ItemFormState } from "../actions";
import { SimpleArea, UnitPicker } from "./unit-picker";

/** 건물 정보를 받기 전 임시 판별(검색 결과만으로) */
function guessType(c: AddressCandidate): PropertyType {
  if (c.complexType && c.complexType in PROPERTY_TYPES) return c.complexType as PropertyType;
  if (c.isApartment) return "apt";
  if (c.mountain) return "forest";
  if (!c.buildingName) return "land";
  return "house";
}

function candidateBadge(c: AddressCandidate): string {
  if (c.complexType && c.complexType in PROPERTY_TYPES) return PROPERTY_TYPES[c.complexType as PropertyType].label;
  if (c.isApartment) return "공동주택";
  if (c.mountain) return "임야(산)";
  if (!c.buildingName) return "토지";
  return "건물";
}

function inspectQuery(c: AddressCandidate) {
  return new URLSearchParams({
    sgg: c.sggCd,
    lawd: c.lawdCd ?? "",
    umd: c.emdName ?? "",
    jibun: c.jibun ?? "",
    mountain: c.mountain ? "1" : "0",
    bonbun: c.bonbun != null ? String(c.bonbun) : "",
    bubun: c.bubun != null ? String(c.bubun) : "",
    complexId: c.complexId ? String(c.complexId) : "",
    apt: c.isApartment ? "1" : "0",
    name: c.buildingName ?? "",
    dongs: c.dongs.join(","),
  }).toString();
}

export function NewItemForm() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<AddressCandidate[]>([]);
  const [meta, setMeta] = useState<{ jusoEnabled?: boolean; jusoError?: string | null }>({});
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<AddressCandidate | null>(null);
  // 사용자가 직접 바꾼 유형(없으면 자동 판별 값을 쓴다)
  const [typeOverride, setTypeOverride] = useState<PropertyType | null>(null);
  const [inspect, setInspect] = useState<{ key: string; data: InspectResult | null } | null>(null);
  const [area, setArea] = useState<number | null>(null);
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

  // 고른 주소의 건물 정보(유형·평형·동·호·면적). 응답은 요청 키와 함께 저장해 오래된 응답을 무시한다.
  const inspectKey = picked ? inspectQuery(picked) : null;
  useEffect(() => {
    if (!inspectKey) return;
    const ctl = new AbortController();
    fetch(`/api/address/inspect?${inspectKey}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: InspectResult | null) => setInspect({ key: inspectKey, data }))
      .catch(() => {
        if (!ctl.signal.aborted) setInspect({ key: inspectKey, data: null });
      });
    return () => ctl.abort();
  }, [inspectKey]);
  const info = inspectKey && inspect?.key === inspectKey ? inspect.data : null;
  const inspecting = Boolean(inspectKey && inspect?.key !== inspectKey);

  const autoType = info?.suggestedType ?? (picked ? guessType(picked) : "apt");
  const type = typeOverride ?? autoType;
  const isLand = type === "land" || type === "forest";
  const matched = info?.complex ?? null;
  const name = matched?.name ?? picked?.buildingName ?? info?.building?.name ?? "";
  const pickedArea = area ?? (info?.areaTypes.length === 1 ? info.areaTypes[0].area : null);
  const defaultLabel = name ? `${name}${pickedArea && !isLand ? ` ${Math.floor(pickedArea)}㎡` : ""}` : "";
  const usePicker = !isLand && (PROPERTY_TYPES[type].hasComplex || Boolean(info?.units?.length));

  const reset = () => {
    setPicked(null);
    setTypeOverride(null);
    setArea(null);
  };

  return (
    <form action={action} className="space-y-4">
      <Card className="p-4">
        <Field label="주소 · 단지명 · 지번 검색">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <Input
              value={picked ? picked.roadAddr ?? picked.jibunAddr : q}
              onChange={(e) => {
                reset();
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
                    setTypeOverride(null);
                    setArea(null);
                  }}
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Badge tone={r.complexId ? "accent" : "neutral"}>{candidateBadge(r)}</Badge>
                    <span className="min-w-0 truncate">
                      {r.buildingName ? `${r.buildingName} · ` : ""}
                      {r.roadAddr ?? r.jibunAddr}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {r.complexId ? "실거래 수집됨 · " : ""}
                    {r.dongs.length > 1 ? `${r.dongs.length}개 동 · ` : ""}
                    지번 {r.jibunAddr}
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
          <input type="hidden" name="building_name" value={name} />
          <input type="hidden" name="default_label" value={defaultLabel} />
          <input type="hidden" name="sido_name" value={picked.sidoName ?? ""} />
          <input type="hidden" name="sgg_name" value={picked.sggName ?? ""} />
          <input type="hidden" name="emd_name" value={picked.emdName ?? ""} />
          <input type="hidden" name="bonbun" value={picked.bonbun ?? ""} />
          <input type="hidden" name="bubun" value={picked.bubun ?? ""} />
          <input type="hidden" name="mountain" value={picked.mountain ? "1" : "0"} />
          <input type="hidden" name="complex_id" value={matched?.id ?? picked.complexId ?? ""} />

          <BuildingSummary info={info} inspecting={inspecting} name={name} />

          <Field
            label="유형"
            hint={
              typeOverride
                ? undefined
                : info?.typeReason
                  ? `자동 판별: ${info.typeReason}. 다르면 눌러서 바꾸세요.`
                  : inspecting
                    ? "건물 용도를 확인하는 중…"
                    : "검색 결과로 추정했습니다. 다르면 눌러서 바꾸세요."
            }
          >
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
              {(Object.keys(PROPERTY_TYPES) as PropertyType[]).map((k) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setTypeOverride(k)}
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

          {PROPERTY_TYPES[type].hasComplex && !inspecting && !matched ? (
            <Notice tone="warn">아직 이 주소의 실거래가 수집되지 않았습니다. 등록 후 다음 수집 때 자동으로 연결됩니다.</Notice>
          ) : null}
          {isLand ? <Notice>토지·임야 실거래는 지번 일부가 공개되지 않아 같은 읍면동의 유사 면적 거래와 비교합니다.</Notice> : null}

          <DetailFields
            isLand={isLand}
            labelPlaceholder={defaultLabel ? `비워 두면 "${defaultLabel}"` : "예) 우리집, 매수후보 A"}
            defaultRadius={PROPERTY_TYPES[type].hasComplex ? 1000 : 2000}
            unitSlot={
              inspecting ? (
                <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-3 text-sm text-muted">
                  <Loader2 size={16} className="animate-spin" /> 평형·동·호 목록을 불러오는 중…
                </div>
              ) : usePicker ? (
                <UnitPicker
                  key={`${inspectKey}|${type}`}
                  areaTypes={info?.areaTypes ?? []}
                  dongs={info?.dongs.length ? info.dongs : picked.dongs}
                  units={info?.units ?? null}
                  partial={info?.unitsPartial ?? false}
                  onAreaChange={setArea}
                />
              ) : (
                <SimpleArea
                  key={`${inspectKey}|${type}`}
                  isLand={isLand}
                  areaLabel={isLand ? "토지 면적(㎡)" : type === "house" ? "연면적(㎡)" : "면적(㎡)"}
                  defaultArea={isLand ? (info?.land?.area ?? null) : type === "house" ? (info?.building?.totalArea ?? null) : null}
                  landArea={type === "house" ? (info?.building?.platArea ?? info?.land?.area ?? null) : null}
                />
              )
            }
          />

          {info?.notes.length ? (
            <ul className="space-y-0.5 text-xs text-muted">
              {info.notes.map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          ) : null}
          {state.error ? <p className="text-sm text-up">{state.error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={reset}>
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

function BuildingSummary({ info, inspecting, name }: { info: InspectResult | null; inspecting: boolean; name: string }) {
  if (inspecting) return null;
  const b = info?.building;
  const c = info?.complex;
  const facts = [
    b?.purpose,
    (c?.build_year ?? b?.approvedYear) ? `${c?.build_year ?? b?.approvedYear}년 준공` : null,
    (c?.households ?? b?.households) ? `${(c?.households ?? b?.households)!.toLocaleString()}세대` : null,
    b && b.dongCount > 1 ? `${b.dongCount}개 동` : null,
    b?.maxFloor ? `최고 ${b.maxFloor}층` : null,
    info?.land?.jimok ? `지목 ${info.land.jimok}` : null,
    info?.land?.area ? `토지 ${info.land.area.toLocaleString()}㎡` : null,
  ].filter(Boolean);
  if (!name && !facts.length) return null;
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">{name || "건물 정보"}</span>
        {c ? <Badge tone="accent">실거래 단지 연결</Badge> : null}
      </div>
      {facts.length ? <p className="mt-0.5 text-xs text-muted">{facts.join(" · ")}</p> : null}
    </div>
  );
}
