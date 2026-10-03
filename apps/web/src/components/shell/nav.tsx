"use client";

import clsx from "clsx";
import { Bell, Settings, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { bottomTabs, isActive, type NavItem, navSections } from "./nav-config";
import { ThemeToggle } from "./theme-picker";

/** 셸에 필요한 사용자 정보(방문자는 null) */
export type ShellViewer = {
  email: string | null;
  isGuest: boolean;
  isAdmin: boolean;
  unread: number;
  itemCount: number;
} | null;

function Logo({ size = 8 }: { size?: 6 | 8 }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon.svg" alt="" className={size === 8 ? "h-8 w-8" : "h-6 w-6"} />
      <span className={clsx("font-bold tracking-tight", size === 8 && "text-lg")}>마이리얼티</span>
    </Link>
  );
}

export function Sidebar({ viewer }: { viewer: ShellViewer }) {
  const path = usePathname();
  const sections = navSections((viewer?.itemCount ?? 0) > 0);
  const all = sections.flatMap((s) => s.items);
  const member = viewer && !viewer.isGuest ? viewer : null;
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="px-5 pb-4 pt-5">
        <Logo />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {sections.map((s, i) => (
          <div key={i} className={i ? "mt-5" : ""}>
            {s.title ? <p className="mb-1 px-3 text-[0.75rem] font-semibold tracking-wide text-muted">{s.title}</p> : null}
            <div className="flex flex-col gap-0.5">
              {s.items.map((n) => (
                <SideLink
                  key={n.href + n.label}
                  item={n}
                  active={isActive(path, n, all)}
                  badge={n.href === "/notifications" ? (viewer?.unread ?? 0) : 0}
                  locked={Boolean(n.member && !member)}
                />
              ))}
            </div>
          </div>
        ))}
        {viewer?.isAdmin ? (
          <div className="mt-5">
            <SideLink item={{ href: "/admin", label: "관리", icon: ShieldCheck }} active={isActive(path, { href: "/admin" })} />
          </div>
        ) : null}
      </nav>
      <div className="border-t border-border p-3">
        {member ? (
          <div className="flex items-center gap-1">
            <Link href="/settings" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <Avatar email={member.email} />
              <span className="min-w-0 truncate text-xs text-muted">{member.email}</span>
            </Link>
            <ThemeToggle className="shrink-0" />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="px-1 text-xs leading-relaxed text-muted">
              {viewer ? "게스트로 이용 중 · 이 기기에 저장됩니다" : "로그인 없이 둘러보는 중"}
            </p>
            <div className="flex items-center gap-1">
              <Link href="/login" className="flex h-9 flex-1 items-center justify-center rounded-lg bg-accent text-sm font-medium text-white hover:brightness-110">
                이메일 간편 가입
              </Link>
              <Link href="/settings" aria-label="설정" className="rounded-lg p-2 text-muted hover:bg-surface-2">
                <Settings size={18} />
              </Link>
              <ThemeToggle className="shrink-0" />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function Avatar({ email }: { email: string | null }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold uppercase text-accent">
      {email ? email[0] : <UserRound size={14} />}
    </span>
  );
}

function SideLink({ item, active, badge = 0, locked = false }: { item: NavItem; active: boolean; badge?: number; locked?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={clsx(
        "flex h-11 items-center gap-3 rounded-lg px-3 text-[1rem]",
        active ? "bg-accent-soft font-semibold text-accent" : "text-text hover:bg-surface-2",
      )}
    >
      <Icon size={20} strokeWidth={active ? 2.3 : 1.8} />
      <span>{item.label}</span>
      {badge > 0 ? (
        <span className="ml-auto rounded-full bg-up px-1.5 text-[0.75rem] font-semibold text-white">{badge > 99 ? "99+" : badge}</span>
      ) : locked ? (
        <span className="ml-auto text-[0.75rem] font-medium text-muted">가입</span>
      ) : null}
    </Link>
  );
}

export function BottomTabs({ viewer }: { viewer: ShellViewer }) {
  const path = usePathname();
  const tabs = bottomTabs((viewer?.itemCount ?? 0) > 0);
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {tabs.map((t) => {
          const active = isActive(path, t, tabs);
          const Icon = t.icon;
          return (
            <Link
              key={t.label}
              href={t.href}
              className={clsx("relative flex min-h-14 flex-col items-center justify-center gap-0.5 py-1.5 text-xs", active ? "font-semibold text-accent" : "text-muted")}
            >
              <Icon size={24} strokeWidth={active ? 2.4 : 1.8} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileTopBar({ viewer }: { viewer: ShellViewer }) {
  const unread = viewer?.unread ?? 0;
  const member = viewer && !viewer.isGuest ? viewer : null;
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur lg:hidden">
      <Logo size={6} />
      <div className="flex items-center gap-1">
        {viewer ? (
          <Link href="/notifications" aria-label="알림" className="relative rounded-lg p-2.5 text-muted hover:bg-surface-2">
            <Bell size={22} />
            {unread > 0 ? (
              <span className="absolute right-1 top-1 min-w-4 rounded-full bg-up px-1 text-center text-[0.75rem] font-bold leading-4 text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Link>
        ) : null}
        {member ? (
          <Link href="/settings" aria-label="내 계정·설정" className="rounded-lg p-1.5 hover:bg-surface-2">
            <Avatar email={member.email} />
          </Link>
        ) : (
          <Link href="/login" className="ml-1 rounded-full border border-accent/40 px-3.5 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft">
            간편 가입
          </Link>
        )}
      </div>
    </header>
  );
}
