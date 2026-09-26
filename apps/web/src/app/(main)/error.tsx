"use client";

import { Button, LinkButton } from "@/components/ui";

export default function MainError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h2 className="text-lg font-semibold">화면을 불러오지 못했습니다</h2>
      <p className="mt-2 text-sm text-muted">
        일시적인 서버 오류일 수 있습니다. 잠시 후 다시 시도하세요.
        {error.digest ? <span className="mt-1 block font-mono text-xs">오류 번호 {error.digest}</span> : null}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button type="button" onClick={() => retry()}>다시 시도</Button>
        <LinkButton href="/" variant="ghost">홈으로</LinkButton>
      </div>
    </div>
  );
}
