"use client";

import { type ReactNode, useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { formatManwon } from "@/lib/format";
import type { FinanceProfile } from "@/lib/brief";
import { GROUP_TAGS } from "@/lib/property";
import type { Lease, Loan } from "@/lib/queries/items";
import { ChoiceChips, DongHoField, MoneyField, RADIUS_OPTIONS } from "./smart-inputs";

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
  unitSlot,
  labelPlaceholder = "예) 우리집, 매수후보 A",
  defaultRadius = 1000,
  profile,
  showProfile = false,
}: {
  /** 새로 등록할 때 매수 후보면 내 자금(가용 현금·연소득)을 함께 받는다(계정 설정에 저장) */
  showProfile?: boolean;
  profile?: FinanceProfile | null;
  /** 새로 등록할 때 유형별 기본 반경(아파트 1km, 토지 2km) */
  defaultRadius?: number;
  d?: DetailDefaults;
  isLand?: boolean;
  areaOptions?: { area: number; n: number }[];
  showKeywords?: boolean;
  /** 면적·층·동/호 입력을 대신 그릴 요소(등록 화면의 평형·동·호 선택) */
  unitSlot?: ReactNode;
  labelPlaceholder?: string;
}) {
  const loan = d.loans?.[0];
  const [area, setArea] = useState<string>(isLand ? String(d.land_area_m2 ?? "") : String(d.area_m2 ?? ""));
  const [group, setGroup] = useState(d.group_tag ?? "watch");
  const [finance, setFinance] = useState(Boolean(d.purchase_price || loan || d.lease) || group === "owned" || group === "tenant");
  // 관계마다 필요한 칸만 보인다(숨긴 칸도 값은 그대로 보내 수정 때 지워지지 않는다)
  const tenant = group === "tenant";
  const showPurchase = !tenant && group !== "candidate";
  return (
    <div className="space-y-4">
      <ChoiceChips
        name="group_tag"
        label="이 부동산은"
        options={Object.entries(GROUP_TAGS).map(([value, label]) => ({ value, label }))}
        defaultValue={group}
        onChange={(v) => {
          setGroup(v);
          if (v === "owned" || v === "tenant") setFinance(true);
        }}
        hint="보유는 손익·대출 부담에, 전월세 거주는 보증금 점검에, 매수 후보는 자금 계산에 쓰입니다."
      />
      <Field label="이름(표시용)">
        <Input name="label" defaultValue={d.label ?? ""} placeholder={labelPlaceholder} />
      </Field>

      {unitSlot ?? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={isLand ? "토지 면적(㎡)" : "전용면적(㎡)"}>
              <Input name="area_m2" inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} placeholder="84.9" />
            </Field>
            {!isLand ? <DongHoField defaultValue={d.dong_ho} defaultFloor={d.floor} /> : null}
          </div>
          {areaOptions && areaOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {areaOptions.map((a) => (
                <button
                  type="button"
                  key={a.area}
                  onClick={() => setArea(String(a.area))}
                  className={`rounded-full border px-3 py-1.5 text-sm ${String(a.area) === area ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}
                >
                  {a.area}㎡ · {(a.area / 3.305785).toFixed(0)}평 <span className="opacity-60">({a.n})</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}

      {showProfile ? (
        // 다른 관계를 눌렀다 돌아와도 입력값이 남도록 숨기기만 한다(서버는 매수 후보일 때만 저장)
        <div className={group === "candidate" ? "space-y-3 rounded-xl bg-surface-2 p-4" : "hidden"}>
          <p className="text-sm font-medium">자금 정보 (선택) — 필요한 대출·월 상환 계산용</p>
          {profile?.cash != null ? (
            <p className="text-xs text-muted">
              저장된 자금: 현금 {formatManwon(profile.cash, { short: true })}
              {profile.income ? ` · 연소득 ${formatManwon(profile.income, { short: true })}` : ""} · LTV {Math.round(profile.ltv * 100)}%. 바꾸려면 아래에 새로 넣으세요.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MoneyField label="집 사는 데 쓸 수 있는 현금" name="profile_cash" placeholder="예) 3억 5000" />
            <MoneyField label="가구 연소득(세전)" name="profile_income" placeholder="예) 8000만" />
          </div>
          <p className="text-xs text-muted">모든 매수 후보에 같이 쓰이고, 설정 › 내 자금에서 바꿀 수 있습니다. 다른 사람에게 보이지 않습니다.</p>
        </div>
      ) : null}

      {group === "candidate" ? null : (
        <button type="button" className="text-sm font-medium text-accent" onClick={() => setFinance((v) => !v)}>
          {finance ? `− ${tenant ? "보증금" : "매입·대출·임대"} 정보 접기` : `+ ${tenant ? "보증금·계약 만기" : "매입·대출·임대 정보"} 입력 (선택)`}
        </button>
      )}
      {finance ? (
        <div className={group === "candidate" ? "hidden" : "space-y-4 rounded-xl bg-surface-2 p-4"}>
          {tenant ? <p className="text-xs text-muted">보증금을 넣으면 깡통전세 비율·보증보험 한도·전세 시세와 비교합니다.</p> : null}

          <div className={showPurchase ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "hidden"}>
            <MoneyField label="매입가" name="purchase_price" defaultValue={d.purchase_price} />
            <Field label="매입일">
              <Input name="purchase_date" type="date" defaultValue={d.purchase_date ?? ""} />
            </Field>
          </div>
          <div className={showPurchase ? "grid grid-cols-1 gap-4 sm:grid-cols-4" : "hidden"}>
            <MoneyField label="대출금" name="loan_amount" defaultValue={loan?.amount} placeholder="예) 6억" />
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
            <MoneyField label="보증금" name="lease_deposit" defaultValue={d.lease?.deposit} placeholder="예) 5억" />
            <MoneyField label="월세" name="lease_rent" defaultValue={d.lease?.rent || null} placeholder="예) 150만" />
            <Field label="계약 만기">
              <Input name="lease_end" type="date" defaultValue={d.lease?.end_date ?? ""} />
            </Field>
            {tenant ? (
              <input type="hidden" name="lease_role" value="tenant" />
            ) : (
              <Field label="내 역할">
                <Select name="lease_role" defaultValue={d.lease?.role ?? "landlord"}>
                  <option value="landlord">임대인(세 놓음)</option>
                  <option value="tenant">임차인(세 들어 삶)</option>
                </Select>
              </Field>
            )}
          </div>
        </div>
      ) : null}

      <ChoiceChips
        key={d.radius_m ?? defaultRadius}
        name="radius_m"
        label="주변 거래·입지를 볼 범위"
        options={RADIUS_OPTIONS}
        defaultValue={String(d.radius_m ?? defaultRadius)}
        hint="아파트 1km, 단독·상가 2km, 토지 5km, 임야 10km 가 보통입니다(거래가 드물수록 넓게)."
      />

      <details className="group rounded-xl border border-border px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-muted group-open:mb-3">고급 설정 · 뉴스 키워드</summary>
        {showKeywords ? (
          <Field label="뉴스 키워드(쉼표 구분)" hint="단지명·동네·시군구 키워드는 자동으로 만들어집니다.">
            <Input name="keywords" defaultValue={(d.keywords ?? []).join(", ")} />
          </Field>
        ) : (
          <Field label="추가 뉴스 키워드(선택, 쉼표 구분)" hint="단지명·동네·시군구 키워드는 자동으로 만들어집니다.">
            <Input name="keywords" placeholder="예) GTX-A, 잠실 재건축" />
          </Field>
        )}
      </details>
    </div>
  );
}

