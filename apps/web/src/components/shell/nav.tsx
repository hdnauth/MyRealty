"use client";

import clsx from "clsx";
import {
  Bell,
  Bot,
  Building2,
  CalendarDays,
  Columns3,
  Construction,
  Home,
  LineChart,
  Map as MapIcon,
  Menu,
  MessagesSquare,
  Settings,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-picker";

const PRIMARY = [
  { href: "/", label: "홈", icon: Home },
  { href: "/map", label: "지도", icon: MapIcon },
  { href: "/items", label: "관심 부동산", icon: Building2 },
  { href: "/indicators", label: "지표", icon: LineChart },
  { href: "/ai", label: "AI", icon: Bot },
];
const SECONDARY = [
  { href: "/community", label: "동네 이야기", icon: MessagesSquare },
  { href: "/portfolio", label: "포트폴리오", icon: Wallet },
  { href: "/compare", label: "비교", icon: Columns3 },
  { href: "/calendar", label: "캘린더", icon: CalendarDays },
  { href: "/projects", label: "개발사업", icon: Construction },
  { href: "/notifications", label: "알림", icon: Bell },
  { href: "/settings", label: "설정", icon: Settings },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function Sidebar({ unread, email, isAdmin = false }: { unread: number; email: string; isAdmin?: boolean }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" className="h-8 w-8" />
        <span className="text-lg font-bold tracking-tight">MyRealty</span>
      </Link>
      <nav className="flex flex-col gap-0.5">
        {PRIMARY.map((n) => (
          <NavLink key={n.href} {...n} active={isActive(path, n.href)} />
        ))}
        <div className="my-3 h-px bg-border" />
        {SECONDARY.map((n) => (
          <NavLink key={n.href} {...n} active={isActive(path, n.href)} badge={n.href === "/notifications" ? unread : 0} />
        ))}
        {isAdmin ? <NavLink href="/admin" label="관리" icon={ShieldCheck} active={isActive(path, "/admin")} /> : null}
      </nav>
      <div className="mt-auto flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate px-2 text-xs text-muted">{email}</span>
        <ThemeToggle className="shrink-0" />
      </div>
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  badge = 0,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-[15px]",
        active ? "bg-accent-soft font-semibold text-accent" : "text-text hover:bg-surface-2",
      )}
    >
      <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
      <span>{label}</span>
      {badge > 0 ? (
        <span className="ml-auto rounded-full bg-up px-1.5 text-[11px] font-semibold text-white">{badge > 99 ? "99+" : badge}</span>
      ) : null}
    </Link>
  );
}

export function BottomTabs() {
  const path = usePathname();
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {PRIMARY.map(({ href, label, icon: Icon }) => {
          const active = isActive(path, href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex flex-col items-center gap-0.5 py-2 text-[11px]",
                active ? "font-semibold text-accent" : "text-muted",
              )}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function MobileTopBar({ unread }: { unread: number }) {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur lg:hidden">
      <Link href="/" className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" className="h-6 w-6" />
        <span className="font-bold tracking-tight">MyRealty</span>
      </Link>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Link href="/community" aria-label="동네 이야기" className="rounded-lg p-2 text-muted hover:bg-surface-2">
          <MessagesSquare size={20} />
        </Link>
        <Link href="/calendar" aria-label="캘린더" className="rounded-lg p-2 text-muted hover:bg-surface-2">
          <CalendarDays size={20} />
        </Link>
        <Link href="/notifications" aria-label="알림" className="relative rounded-lg p-2 text-muted hover:bg-surface-2">
          <Bell size={20} />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 min-w-4 rounded-full bg-up px-1 text-center text-[10px] font-bold leading-4 text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Link>
        <Link href="/settings" aria-label="메뉴·설정" className="rounded-lg p-2 text-muted hover:bg-surface-2">
          <Menu size={20} />
        </Link>
      </div>
    </header>
  );
}
