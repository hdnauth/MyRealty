"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "개요" },
  { href: "/admin/users", label: "사용자" },
  { href: "/admin/settings", label: "사이트 설정" },
  { href: "/admin/system", label: "시스템" },
  { href: "/admin/audit", label: "작업 기록" },
];

export function AdminTabs() {
  const path = usePathname();
  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:px-0">
      {TABS.map((t) => {
        const active = t.href === "/admin" ? path === "/admin" : path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={clsx(
              "shrink-0 border-b-2 px-3 py-2 text-sm",
              active ? "border-accent font-semibold text-accent" : "border-transparent text-muted hover:text-text",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
