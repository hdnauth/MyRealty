"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { GROUP_TAGS } from "@/lib/property";
import type { Lease, Loan } from "@/lib/queries/items";

export type DetailDefaults = {
  label?: string | null;
  group_tag?: string;
  dong_ho?: string | null;
  area_m2?: number | null;
  land_area_m2?: number | null;
  floor?: number | null;
  purchase_price?: number | null;
  purchase_date?: string | null;
  loans?: Loan[];
  lease?: Lease | null;
  keywords?: string[];
  radius_m?: number;
};

/** 등록·수정 공통 입력 필드 (금액은 만원 단위) */
export function DetailFields({
  d = {},
  isLand = false,
  areaOptions,
  showKeywords = false,
}: {
  d?: DetailDefaults;
  isLand?: boolean;
  areaOptions?: { area: number; n: number }[];
  showKeywords?: boolean;
}) {
  const loan = d.loans?.[0];
  const [area, setArea] = useState<string>(isLand ? String(d.land_area_m2 ?? "") : String(d.area_m2 ?? ""));
  const [finance, setFinance] = useState(Boolean(d.purchase_price || loan || d.lease));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="이름(표시용)">
          <Input name="label" defaultValue={d.label ?? ""} placeholder="예) 우리집, 매수후보 A" />
        </Field>
        <Field label="그룹">
          <Select name="group_tag" defaultValue={d.group_tag ?? "watch"}>
            {Object.entries(GROUP_TAGS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={isLand ? "토지 면적(㎡)" : "전용면적(㎡)"}>
          <Input name="area_m2" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} placeholder="84.9" />
        </Field>
        {!isLand ? (
          <>
            <Field label="층">
              <Input name="floor" inputMode="numeric" defaultValue={d.floor ?? ""} />
            </Field>
            <Field label="동/호">
              <Input name="dong_ho" defaultValue={d.dong_ho ?? ""} placeholder="101동 1502호" />
            </Field>
          </>
        ) : null}
      </div>
      {areaOptions && areaOptions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {areaOptions.map((a) => (
            <button
              type="button"
              key={a.area}
              onClick={() => setArea(String(a.area))}
              className={`rounded-full border px-2.5 py-1 text-xs ${String(a.area) === area ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}
            >
              {a.area}㎡ · {(a.area / 3.305785).toFixed(0)}평 <span className="opacity-60">({a.n})</span>
            </button>
          ))}
        </div>
      ) : null}

      <button type="button" className="text-sm font-medium text-accent" onClick={() => setFinance((v) => !v)}>
        {finance ? "− 매입·대출·임대 정보 접기" : "+ 매입·대출·임대 정보 입력 (선택)"}
      </button>
      {finance ? (
        <div className="space-y-4 rounded-xl bg-surface-2 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="매입가(만원)">
              <Input name="purchase_price" inputMode="numeric" defaultValue={d.purchase_price ?? ""} placeholder="150000 = 15억" />
            </Field>
            <Field label="매입일">
              <Input name="purchase_date" type="date" defaultValue={d.purchase_date ?? ""} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="대출금(만원)">
              <Input name="loan_amount" inputMode="numeric" defaultValue={loan?.amount ?? ""} />
            </Field>
            <Field label="금리(%)">
              <Input name="loan_rate" inputMode="decimal" defaultValue={loan?.rate ?? ""} />
            </Field>
            <Field label="기간(년)">
              <Input name="loan_years" inputMode="numeric" defaultValue={loan?.years ?? ""} />
            </Field>
            <Field label="만기">
              <Input name="loan_maturity" type="date" defaultValue={loan?.maturity ?? ""} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="임대 보증금(만원)">
              <Input name="lease_deposit" inputMode="numeric" defaultValue={d.lease?.deposit ?? ""} />
            </Field>
            <Field label="월세(만원)">
              <Input name="lease_rent" inputMode="numeric" defaultValue={d.lease?.rent ?? ""} />
            </Field>
            <Field label="계약 만기">
              <Input name="lease_end" type="date" defaultValue={d.lease?.end_date ?? ""} />
            </Field>
            <Field label="내 역할">
              <Select name="lease_role" defaultValue={d.lease?.role ?? "landlord"}>
                <option value="landlord">임대인</option>
                <option value="tenant">임차인</option>
              </Select>
            </Field>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="주변 탐색 반경(m)">
          <Input name="radius_m" inputMode="numeric" defaultValue={d.radius_m ?? ""} placeholder="아파트 1000 / 토지 2000" />
        </Field>
        {showKeywords ? (
          <Field label="뉴스 키워드(쉼표 구분)">
            <Input name="keywords" defaultValue={(d.keywords ?? []).join(", ")} />
          </Field>
        ) : (
          <Field label="추가 뉴스 키워드(선택, 쉼표 구분)">
            <Input name="keywords" placeholder="예) GTX-A, 잠실 재건축" />
          </Field>
        )}
      </div>
    </div>
  );
}
