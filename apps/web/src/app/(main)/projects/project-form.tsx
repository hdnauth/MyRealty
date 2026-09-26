"use client";

import { useActionState, useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { addProjectAction, type ProjectFormState } from "./actions";

export function ProjectForm() {
  const [type, setType] = useState<"zone" | "infra">("zone");
  const [state, action, pending] = useActionState<ProjectFormState, FormData>(addProjectAction, {});
  return (
    <form action={action} className="space-y-3 p-4">
      <input type="hidden" name="type" value={type} />
      <div className="flex gap-1.5">
        {(["zone", "infra"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setType(t)} className={`rounded-full border px-3 py-1 text-sm ${type === t ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}>
            {t === "zone" ? "재개발·재건축" : "철도·도로"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="이름"><Input name="name" required placeholder={type === "zone" ? "예) ○○ 재건축" : "예) ○○선 △△역"} /></Field>
        {type === "zone" ? (
          <>
            <Field label="유형">
              <Select name="kind">{["재건축", "재개발", "리모델링", "가로주택", "소규모재건축", "기타"].map((k) => <option key={k}>{k}</option>)}</Select>
            </Field>
            <Field label="단계">
              <Select name="stage">{["기본계획", "정비구역지정", "추진위", "조합설립", "사업시행인가", "관리처분인가", "이주·철거", "착공", "준공"].map((k) => <option key={k}>{k}</option>)}</Select>
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
              <Select name="status">{["계획", "예타", "설계", "착공", "개통예정", "개통"].map((k) => <option key={k}>{k}</option>)}</Select>
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
