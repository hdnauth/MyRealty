import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { changeTone } from "@/lib/format";

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={clsx("card", className)} {...p} />;
}

export function CardHeader({ title, action, sub }: { title: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0 text-sm">{action}</div> : null}
    </div>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 h-10 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
const btnVariants: Record<BtnVariant, string> = {
  primary: "bg-accent text-white hover:brightness-110",
  secondary: "bg-surface-2 text-text border border-border hover:bg-border/60",
  ghost: "text-text hover:bg-surface-2",
  danger: "bg-up text-white hover:brightness-110",
};

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant }) {
  return <button className={clsx(btnBase, btnVariants[variant], className)} {...p} />;
}

export function LinkButton({
  variant = "primary",
  className,
  ...p
}: ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link className={clsx(btnBase, btnVariants[variant], className)} {...p} />;
}

export function Badge({
  tone = "neutral",
  className,
  ...p
}: ComponentProps<"span"> & { tone?: "neutral" | "accent" | "up" | "down" | "warn" | "ok" }) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    accent: "bg-accent-soft text-accent",
    up: "bg-up/10 text-up",
    down: "bg-down/10 text-down",
    warn: "bg-warn/10 text-warn",
    ok: "bg-ok/10 text-ok",
  };
  return (
    <span
      className={clsx("inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium", tones[tone], className)}
      {...p}
    />
  );
}

export function Input({ className, ...p }: ComponentProps<"input">) {
  return (
    <input
      className={clsx(
        "h-11 w-full rounded-lg border border-border bg-surface px-3 text-[15px] outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...p}
    />
  );
}

export function Select({ className, ...p }: ComponentProps<"select">) {
  return (
    <select
      className={clsx(
        "h-11 w-full rounded-lg border border-border bg-surface px-3 text-[15px] outline-none focus:border-accent",
        className,
      )}
      {...p}
    />
  );
}

export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={clsx(
        "w-full rounded-lg border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-accent",
        className,
      )}
      {...p}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Change({ value, digits = 1, className }: { value: number | null | undefined; digits?: number; className?: string }) {
  const tone = changeTone(value);
  if (value === null || value === undefined) return <span className={clsx("text-muted", className)}>-</span>;
  return (
    <span className={clsx("tabular font-medium", tone === "up" && "text-up", tone === "down" && "text-down", tone === "flat" && "text-muted", className)}>
      {tone === "up" ? "▲" : tone === "down" ? "▼" : ""}
      {Math.abs(value * 100).toFixed(digits)}%
    </span>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-0.5 truncate text-lg font-semibold">{value}</div>
      {sub ? <div className="mt-0.5 text-xs">{sub}</div> : null}
    </div>
  );
}

export function EmptyState({ title, desc, action }: { title: string; desc?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {desc ? <p className="max-w-sm text-sm text-muted">{desc}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
        {sub ? <p className="mt-1 text-sm text-muted">{sub}</p> : null}
      </div>
      {action ? <div className="shrink-0 whitespace-nowrap">{action}</div> : null}
    </div>
  );
}

export function Tabs({ items, active }: { items: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <div className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="inline-flex gap-1 rounded-xl bg-surface-2 p-1">
        {items.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            scroll={false}
            className={clsx(
              "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium",
              t.key === active ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "warn"; children: ReactNode }) {
  return (
    <div
      className={clsx(
        "rounded-lg px-3 py-2 text-[13px]",
        tone === "warn" ? "bg-warn/10 text-warn" : "bg-surface-2 text-muted",
      )}
    >
      {children}
    </div>
  );
}
