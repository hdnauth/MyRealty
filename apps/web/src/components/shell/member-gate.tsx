import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, LinkButton } from "@/components/ui";

/** 이메일 가입이 필요한 기능 자리에 보여 주는 안내(방문자·게스트) */
export function MemberGate({ title, desc, next, children }: { title: string; desc?: ReactNode; next: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
        <LockKeyhole size={20} />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        {desc ? <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{desc}</p> : null}
      </div>
      <LinkButton href={`/login?next=${encodeURIComponent(next)}&why=member`}>이메일로 간편 가입</LinkButton>
      <p className="text-xs text-muted">비밀번호 없이 이메일 코드로 30초면 끝나요. 이 기기에 저장한 관심 부동산도 그대로 이어집니다.</p>
      {children}
    </Card>
  );
}

/** 게스트(이 기기 저장) 안내 한 줄 */
export function GuestNote({ className }: { className?: string }) {
  return (
    <p className={className ?? "rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted"}>
      로그인 없이 <b className="font-medium text-text">이 기기에 저장</b>되고 있어요.{" "}
      <Link href="/login" className="font-medium text-accent">이메일로 가입</Link>하면 다른 기기에서도 이어서 볼 수 있습니다.
    </p>
  );
}
