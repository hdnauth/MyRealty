import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { safeHref } from "@/lib/format";
import { calendarEntries, type CalendarEntry } from "@/lib/queries/feed";

export const metadata: Metadata = { title: "캘린더" };

const KIND: Record<string, { label: string; tone: "accent" | "warn" | "up" | "neutral" | "ok" }> = {
  subscription: { label: "청약", tone: "accent" },
  move_in: { label: "입주", tone: "neutral" },
  official_price: { label: "공시", tone: "ok" },
  tax: { label: "세금", tone: "warn" },
  lease: { label: "임대만기", tone: "up" },
  loan: { label: "대출만기", tone: "up" },
  rate_decision: { label: "금리", tone: "warn" },
};

function ym(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const [uid, sp] = await Promise.all([sessionUserId(), props.searchParams]);
  const base = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? new Date(`${sp.m}-01T00:00:00`) : new Date();
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const iso = (d: Date) => `${ym(d)}-${String(d.getDate()).padStart(2, "0")}`;
  const [, entries] = await Promise.all([requireUser(), calendarEntries(uid, iso(first), iso(last))]);
  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const prev = new Date(first.getFullYear(), first.getMonth() - 1, 1);
  const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  const cells: (Date | null)[] = [...Array(first.getDay()).fill(null)];
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d));
  const today = iso(new Date());

  return (
    <div>
      <PageHeader
        title="캘린더"
        sub="청약·입주·공시가격·세금 일정과 관심 부동산 만기"
        action={
          <div className="flex items-center gap-1">
            <Link href={`/calendar?m=${ym(prev)}`} className="rounded-lg p-2 hover:bg-surface-2" aria-label="이전 달"><ChevronLeft size={18} /></Link>
            <span className="tabular w-20 text-center font-semibold">{first.getFullYear()}.{String(first.getMonth() + 1).padStart(2, "0")}</span>
            <Link href={`/calendar?m=${ym(next)}`} className="rounded-lg p-2 hover:bg-surface-2" aria-label="다음 달"><ChevronRight size={18} /></Link>
          </div>
        }
      />
      <Card className="hidden overflow-hidden md:block">
        <div className="grid grid-cols-7 border-b border-border text-center text-xs text-muted">
          {"일월화수목금토".split("").map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const key = d ? iso(d) : `x${i}`;
            const list = d ? byDay.get(iso(d)) ?? [] : [];
            return (
              <div key={key} className={clsx("min-h-24 border-b border-r border-border p-1.5 text-xs", !d && "bg-surface-2/50")}>
                {d ? <div className={clsx("mb-1 tabular", iso(d) === today && "font-bold text-accent")}>{d.getDate()}</div> : null}
                {list.map((e, j) => (
                  <div key={j} className="mb-0.5 truncate" title={e.title}>
                    <Badge tone={KIND[e.kind]?.tone ?? "neutral"}>{KIND[e.kind]?.label ?? e.kind}</Badge> {e.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Card>
      <Card className="md:hidden">
        {entries.length ? (
          <ul className="divide-y divide-border px-4 text-sm">
            {entries.map((e, i) => (
              <li key={i} className="flex gap-3 py-2.5">
                <span className={clsx("tabular w-11 shrink-0", e.date === today ? "font-bold text-accent" : "text-muted")}>{e.date.slice(5).replace("-", ".")}</span>
                <span className="min-w-0">
                  <Badge tone={KIND[e.kind]?.tone ?? "neutral"}>{KIND[e.kind]?.label ?? e.kind}</Badge>{" "}
                  {safeHref(e.href) ? <a href={safeHref(e.href)!} className="font-medium">{e.title}</a> : <span className="font-medium">{e.title}</span>}
                  {e.sub ? <span className="block text-xs text-muted">{e.sub}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted">이 달의 일정이 없습니다.</p>
        )}
      </Card>
    </div>
  );
}
