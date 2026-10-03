import clsx from "clsx";
import { AlertTriangle, Bell, CalendarDays, Construction, Megaphone, MessageCircle, MessagesSquare, Newspaper, Receipt, ShieldAlert, TrendingDown, TrendingUp, XCircle } from "lucide-react";
import { Badge } from "@/components/ui";
import { safeHref, timeAgo } from "@/lib/format";
import { NotificationLink } from "./notification-link";
import type { Notification } from "@/lib/queries/feed";

const KIND: Record<string, { label: string; icon: typeof Bell; tone: "up" | "down" | "accent" | "warn" | "neutral" }> = {
  record_high: { label: "신고가", icon: TrendingUp, tone: "up" },
  record_low: { label: "저가", icon: TrendingDown, tone: "down" },
  new_trade: { label: "실거래", icon: Receipt, tone: "accent" },
  canceled: { label: "해제", icon: XCircle, tone: "warn" },
  news: { label: "뉴스", icon: Newspaper, tone: "neutral" },
  subscription: { label: "청약", icon: Megaphone, tone: "accent" },
  lease_expiry: { label: "만기", icon: AlertTriangle, tone: "warn" },
  calendar: { label: "일정", icon: CalendarDays, tone: "neutral" },
  indicator: { label: "지표", icon: TrendingUp, tone: "accent" },
  rate: { label: "금리", icon: TrendingUp, tone: "warn" },
  policy: { label: "정책", icon: Megaphone, tone: "warn" },
  community_reply: { label: "댓글", icon: MessageCircle, tone: "accent" },
  community_hot: { label: "동네 이야기", icon: MessagesSquare, tone: "accent" },
  community_mod: { label: "운영", icon: ShieldAlert, tone: "warn" },
  zone_stage: { label: "정비사업", icon: Construction, tone: "accent" },
};

/** 알림 종류 → 이름(관리 화면 통계 등) */
export const NOTIFICATION_LABELS: Record<string, string> = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, v.label]));

export function NotificationRow({ n, showItem = true }: { n: Notification; showItem?: boolean }) {
  const k = KIND[n.kind] ?? { label: n.kind, icon: Bell, tone: "neutral" as const };
  const Icon = k.icon;
  const href = safeHref(n.url);
  const content = (
    <div className={clsx("flex gap-3 px-4 py-3", !n.read_at && "bg-accent-soft/30")}>
      <div
        className={clsx(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          k.tone === "up" && "bg-up/10 text-up",
          k.tone === "down" && "bg-down/10 text-down",
          k.tone === "accent" && "bg-accent-soft text-accent",
          k.tone === "warn" && "bg-warn/10 text-warn",
          k.tone === "neutral" && "bg-surface-2 text-muted",
        )}
      >
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <Badge tone={k.tone}>{k.label}</Badge>
          {showItem && n.item_label ? <span className="truncate">{n.item_label}</span> : null}
          <span>· {timeAgo(n.created_at)}</span>
          {n.priority >= 2 ? <span className="font-semibold text-up">중요</span> : null}
        </div>
        <p className={clsx("mt-1 text-sm leading-snug", !n.read_at && "font-semibold")}>{n.title}</p>
        {n.body ? <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{n.body}</p> : null}
      </div>
    </div>
  );
  return (
    <NotificationLink id={n.id} href={href} unread={!n.read_at}>
      {content}
    </NotificationLink>
  );
}
