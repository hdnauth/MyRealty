"use client";

import { useActionState, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { type LoginState, requestCodeAction, verifyCodeAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [reqState, requestAction, requesting] = useActionState<LoginState, FormData>(requestCodeAction, { step: "email" });
  const [verState, verifyAction, verifying] = useActionState<LoginState, FormData>(verifyCodeAction, { step: "code" });
  const [restart, setRestart] = useState(0);

  const onCodeStep = reqState.step === "code" && restart === 0;

  if (!onCodeStep) {
    return (
      <form action={(fd) => { setRestart(0); requestAction(fd); }} className="space-y-4">
        <Field label="이메일">
          <Input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            defaultValue={reqState.email}
            placeholder="you@example.com"
            autoFocus
          />
        </Field>
        {reqState.error ? <p className="text-sm text-up">{reqState.error}</p> : null}
        <Button type="submit" className="w-full" disabled={requesting}>
          {requesting ? "보내는 중…" : "로그인 코드 받기"}
        </Button>
      </form>
    );
  }

  return (
    <form action={verifyAction} className="space-y-4">
      <input type="hidden" name="email" value={reqState.email} />
      <input type="hidden" name="next" value={next} />
      <p className="text-sm">
        <span className="font-medium">{reqState.email}</span>
        <button type="button" className="ml-2 text-accent underline" onClick={() => setRestart(1)}>
          변경
        </button>
      </p>
      {reqState.info ? <p className="text-xs text-muted">{reqState.info}</p> : null}
      <Field label="6자리 코드">
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          className="text-center text-2xl tracking-[0.5em]"
        />
      </Field>
      {verState.error ? <p className="text-sm text-up">{verState.error}</p> : null}
      <Button type="submit" className="w-full" disabled={verifying}>
        {verifying ? "확인 중…" : "로그인"}
      </Button>
    </form>
  );
}
