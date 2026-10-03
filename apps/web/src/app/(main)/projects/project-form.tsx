"use client";

import { useActionState, useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { INFRA_STATUS, ZONE_KINDS, ZONE_STAGES } from "@/lib/projects";
import { addProjectAction, type ProjectFormState } from "./actions";

export function ProjectForm({ defaultType = "zone" }: { defaultType?: "zone" | "infra" }) {
  const [type, setType] = useState<"zone" | "infra">(defaultType);
  const [state, action, pending] = useActionState<ProjectFormState, FormData>(addProjectAction, {});
  return (
    <form action={action} className="space-y-3 p-4">
      <input type="hidden" name="type" value={type} />
      <div className="flex gap-1.5">
        {(["zone", "infra"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setType(t)} className={`rounded-full border px-3.5 py-1.5 text-sm ${type === t ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}>
            {t === "zone" ? "재개발·재건축" : "철도·도로"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="이름"><Input name="name" required placeholder={type === "zone" ? "예) ○○ 재건축" : "예) ○○선 △△역"} /></Field>
        {type === "zone" ? (
          <>
            <Field label="유형">
              <Select name="kind">{ZONE_KINDS.map((k) => <option key={k}>{k}</option>)}</Select>
            </Field>
            <Field label="단계">
              <Select name="stage">{ZONE_STAGES.map((k) => <option key={k}>{k}</option>)}</Select>
            </Field>
            <Field label="단계 일자"><Input name="date" type="date" /></Field>
            <Field label="계획 세대수"><Input name="households" inputMode="numeric" /></Field>
          </>
        ) : (
          <>
            <Field label="종류">
              <Select name="infra_kind"><option value="station">역</option><option value="rail">노선</option><option value="road">도로</option><option value="ic">IC</option></Select>
            </Field>
            <Field label="노선명"><Input name="line_name" placeholder="예) GTX-A" /></Field>
            <Field label="상태">
              <Select name="status">{INFRA_STATUS.map((k) => <option key={k}>{k}</option>)}</Select>
            </Field>
            <Field label="개통(예정)일"><Input name="date" type="date" /></Field>
          </>
        )}
        <Field label="주소(지오코딩)"><Input name="address" placeholder="예) 서울특별시 송파구 잠실동 27" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="위도(선택)"><Input name="lat" inputMode="decimal" /></Field>
          <Field label="경도(선택)"><Input name="lng" inputMode="decimal" /></Field>
        </div>
      </div>
      {state.error ? <p className="text-sm text-up">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-ok">{state.ok}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "등록 중…" : "등록"}</Button>
    </form>
  );
}
