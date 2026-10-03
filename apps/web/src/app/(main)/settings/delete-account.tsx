"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { deleteAccountAction } from "./actions";

/** email 이 null 이면 게스트: "삭제" 를 입력해 이 기기 데이터를 지운다 */
export function DeleteAccount({ email, disabled }: { email: string | null; disabled: boolean }) {
  const [state, action, pending] = useActionState(deleteAccountAction, {});
  if (disabled) return <p className="px-4 pb-4 text-sm text-muted">관리자(ADMIN_EMAILS) 계정은 탈퇴할 수 없습니다.</p>;
  const word = email ?? "삭제";
  return (
    <form
      action={action}
      onSubmit={(e) => { if (!window.confirm(email ? "정말 탈퇴할까요? 되돌릴 수 없습니다." : "이 기기에 저장한 데이터를 모두 지울까요? 되돌릴 수 없습니다.")) e.preventDefault(); }}
      className="flex flex-wrap gap-2 px-4 pb-4"
    >
      <Input name="confirm" placeholder={`확인: ${word} 입력`} autoComplete="off" className="min-w-56 flex-1" />
      <Button type="submit" variant="danger" disabled={pending}>{email ? "탈퇴" : "데이터 삭제"}</Button>
      {state.error ? <p role="alert" className="basis-full text-sm text-up">{state.error}</p> : null}
    </form>
  );
}
