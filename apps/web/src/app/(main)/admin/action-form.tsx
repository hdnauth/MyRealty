"use client";

import clsx from "clsx";
import { useActionState, type ReactNode } from "react";
import type { AdminActionState } from "./actions";

/** 서버 액션 결과(성공·오류 문구)를 폼 아래에 보여주는 관리 화면 공용 폼 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: (state: AdminActionState, form: FormData) => Promise<AdminActionState>;
  children: ReactNode;
  className?: string;
  /** 제출 전 확인 문구 */
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}
      className={className}
    >
      <fieldset disabled={pending} className={clsx("contents", pending && "opacity-60")}>
        {children}
      </fieldset>
      {state.error ? <p role="alert" className="basis-full text-sm text-up">{state.error}</p> : null}
      {state.ok ? <p role="status" className="basis-full text-sm text-ok">{state.ok}</p> : null}
    </form>
  );
}
