"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { formatManwon } from "@/lib/format";
import { type AreaType, areaTypeLabel, dongHo, dongLabel, floorFromHo, hoLabel, matchAreaType, type UnitTuple } from "@/lib/units";

/**
 * 평형(전용면적) → 동 → 호 순으로 고르면 면적·층·동/호가 채워진다. 호를 먼저 고르면 평형이 따라온다.
 * 대장 정보가 없으면 평형은 직접 입력, 호는 입력한 번호로 층을 추정한다.
 */
export function UnitPicker({
  areaTypes,
  dongs,
  units,
  partial,
  onAreaChange,
}: {
  areaTypes: AreaType[];
  dongs: string[];
  units: UnitTuple[] | null;
  partial: boolean;
  onAreaChange?: (area: number | null) => void;
}) {
  const [area, setAreaRaw] = useState(() => (areaTypes.length === 1 ? String(areaTypes[0].area) : ""));
  const [manualArea, setManualArea] = useState(areaTypes.length === 0);
  const [dong, setDong] = useState(() => (dongs.length === 1 ? dongs[0] : ""));
  const [ho, setHo] = useState("");
  const [floor, setFloor] = useState("");

  const setArea = (v: string) => {
    setAreaRaw(v);
    const x = Number(v);
    onAreaChange?.(v && Number.isFinite(x) ? x : null);
  };

  const selectedType = area ? matchAreaType(areaTypes, Number(area)) : null;
  const dongUnits = useMemo(() => (units ?? []).filter((u) => u[0] === dong), [units, dong]);
  // 평형을 골랐으면 그 평형의 호만. 해당 호가 없으면 전체
  const hoOptions = useMemo(() => {
    const byType = selectedType ? dongUnits.filter((u) => Math.abs(u[3] - selectedType.area) <= 0.5) : dongUnits;
    const list = byType.length ? byType : dongUnits;
    return [...list].sort((a, b) => (a[2] ?? 0) - (b[2] ?? 0) || a[1].localeCompare(b[1], "ko", { numeric: true }));
  }, [dongUnits, selectedType]);
  const floors = useMemo(() => {
    const m = new Map<number | null, UnitTuple[]>();
    for (const u of hoOptions) m.set(u[2], [...(m.get(u[2]) ?? []), u]);
    return [...m.entries()];
  }, [hoOptions]);

  const pickHo = (h: string) => {
    setHo(h);
    const u = dongUnits.find((x) => x[1] === h);
    if (u) {
      if (u[2] !== null) setFloor(String(u[2]));
      setArea(String(u[3]));
      setManualArea(false);
    } else {
      const f = floorFromHo(h);
      if (f) setFloor(String(f));
    }
  };

  return (
    <div className="space-y-4">
      <input type="hidden" name="dong_ho" value={dongHo(dong, ho)} />

      {/* 버튼 묶음이라 <label>(Field) 대신 div: 라벨 클릭이 첫 버튼을 누르지 않도록 */}
      <div>
        <span className="mb-1 block text-[13px] font-medium text-muted">평형(전용면적)</span>
        {areaTypes.length > 0 ? (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {areaTypes.map((t) => {
              const active = !manualArea && selectedType?.area === t.area;
              return (
                <button
                  type="button"
                  key={t.area}
                  onClick={() => {
                    setManualArea(false);
                    setArea(String(t.area));
                    // 고른 호가 다른 평형이면 호 선택을 푼다
                    const u = dongUnits.find((x) => x[1] === ho);
                    if (u && Math.abs(u[3] - t.area) > 0.5) setHo("");
                  }}
                  className={clsx(
                    "rounded-lg border px-2.5 py-2 text-left",
                    active ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
                  )}
                >
                  <span className={clsx("block text-sm font-semibold", active && "text-accent")}>
                    {Math.floor(t.area)}㎡ <span className="font-normal">· {areaTypeLabel(t)}</span>
                  </span>
                  <span className="block text-[11px] text-muted">
                    {[t.units ? `${t.units.toLocaleString()}세대` : null, t.trades ? `거래 ${t.trades}건` : null, `전용 ${t.area}㎡`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {t.medianPrice ? <span className="block text-[11px] font-medium text-text">최근 1년 매매 {formatManwon(t.medianPrice, { short: true })}</span> : null}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setManualArea(true)}
              className={clsx(
                "rounded-lg border border-dashed px-2.5 py-2 text-sm",
                manualArea ? "border-accent text-accent" : "border-border text-muted hover:bg-surface-2",
              )}
            >
              직접 입력
            </button>
          </div>
        ) : null}
        {manualArea ? (
          <Input
            className={areaTypes.length ? "mt-2" : undefined}
            inputMode="decimal"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="전용면적 ㎡ (예: 84.97)"
          />
        ) : null}
        <input type="hidden" name="area_m2" value={area} />
      </div>

      <div className="space-y-2">
        <p className="text-[13px] font-medium text-muted">
          동·호 <span className="font-normal">(선택 — 보유·거주 중이면 공시가격·층 비교가 정확해집니다)</span>
        </p>
        {dongs.length > 0 ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {dongs.map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => {
                  setDong(d === dong ? "" : d);
                  setHo("");
                }}
                className={clsx(
                  "shrink-0 rounded-full border px-3 py-1 text-[13px]",
                  d === dong ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-muted",
                )}
              >
                {dongLabel(d)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          {dongs.length === 0 ? (
            <Mini label="동">
              <Input value={dong} onChange={(e) => setDong(e.target.value)} placeholder="예: 101" />
            </Mini>
          ) : null}
          <Mini label="호" className={dongs.length ? "col-span-2" : undefined}>
            {hoOptions.length > 0 ? (
              <Select value={ho} onChange={(e) => pickHo(e.target.value)}>
                <option value="">{dong ? `${dongLabel(dong)} 호 선택` : "동을 먼저 선택"}</option>
                {floors.map(([f, us]) => (
                  <optgroup key={String(f)} label={f === null ? "층 정보 없음" : f < 0 ? `지하 ${-f}층` : `${f}층`}>
                    {us.map((u) => (
                      <option key={u[1]} value={u[1]}>
                        {hoLabel(u[1])} · {u[3]}㎡
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            ) : (
              <Input value={ho} onChange={(e) => pickHo(e.target.value.trim())} placeholder="예: 1502" inputMode="numeric" />
            )}
          </Mini>
          <Mini label="층">
            <Input name="floor" value={floor} onChange={(e) => setFloor(e.target.value)} inputMode="numeric" placeholder="호에서 자동" />
          </Mini>
        </div>
        {partial && dong && dongUnits.length === 0 ? (
          <p className="text-xs text-muted">대단지라 이 동의 호 목록은 일부만 불러왔습니다. 호를 직접 입력하면 층은 자동으로 채워집니다.</p>
        ) : null}
      </div>
    </div>
  );
}

function Mini({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-0.5 block text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}

/** 단독·토지·임야·상가(호 목록 없음): 대장·토지특성에서 가져온 면적을 채워 둔다 */
export function SimpleArea({
  isLand,
  defaultArea,
  areaLabel,
  landArea,
}: {
  isLand: boolean;
  defaultArea: number | null;
  areaLabel: string;
  landArea: number | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field label={areaLabel} hint={defaultArea ? "공공데이터에서 자동으로 채웠습니다" : undefined}>
        <Input name="area_m2" inputMode="decimal" defaultValue={defaultArea ?? ""} placeholder={isLand ? "예: 330" : "예: 84.9"} />
      </Field>
      {!isLand ? (
        <>
          <Field label="층">
            <Input name="floor" inputMode="numeric" />
          </Field>
          <Field label="동/호">
            <Input name="dong_ho" placeholder="예: 101호" />
          </Field>
          {landArea ? <input type="hidden" name="land_area_m2" value={landArea} /> : null}
        </>
      ) : null}
    </div>
  );
}
