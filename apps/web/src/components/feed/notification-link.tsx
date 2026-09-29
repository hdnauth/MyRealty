"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { markReadAction } from "@/app/(main)/notifications/actions";

/**
 * 알림 행 링크. 누르면 읽음 처리(배지 갱신)한 뒤 이동한다.
 * 외부 링크(뉴스)는 새 탭으로 바로 열고 읽음 처리는 뒤에서 한다.
 */
export function NotificationLink({ id, href, unread, children }: { id: number; href: string | null; unread: boolean; children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const external = !!href && /^https?:\/\//i.test(href);
  const cls = "block w-full text-left hover:bg-surface-2" + (pending ? " opacity-70" : "");

  if (external) {
    return (
      <a href={href!} target="_blank" rel="noreferrer" className={cls} onClick={() => unread && start(() => markReadAction(id))}>
        {children}
      </a>
    );
  }
  if (!href) {
    return unread ? (
      <button type="button" className={cls} onClick={() => start(() => markReadAction(id))} title="읽음으로 표시">
        {children}
      </button>
    ) : (
      <>{children}</>
    );
  }
  return (
    <a
      href={href}
      className={cls}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        start(async () => {
          if (unread) await markReadAction(id);
          router.push(href);
        });
      }}
    >
      {children}
    </a>
  );
}
