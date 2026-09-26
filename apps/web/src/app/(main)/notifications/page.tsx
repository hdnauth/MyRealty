import type { Metadata } from "next";
import { NotificationRow } from "@/components/feed/notification-row";
import { Button, Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { requireUser, sessionUserId } from "@/lib/auth/session";
import { listNotifications } from "@/lib/queries/feed";
import { markAllReadAction } from "./actions";

export const metadata: Metadata = { title: "알림" };

const FILTERS = [
  { key: "all", label: "전체" },
  { key: "unread", label: "안 읽음" },
  { key: "record_high", label: "신고가" },
  { key: "new_trade", label: "실거래" },
  { key: "news", label: "뉴스" },
  { key: "subscription", label: "청약" },
];

export default async function NotificationsPage(props: PageProps<"/notifications">) {
  const [uid, sp] = await Promise.all([sessionUserId(), props.searchParams]);
  const f = FILTERS.find((x) => x.key === sp.f)?.key ?? "all";
  const [, rows] = await Promise.all([
    requireUser(),
    listNotifications(uid, {
      unreadOnly: f === "unread",
      kind: f !== "all" && f !== "unread" ? f : undefined,
      limit: 200,
    }),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="알림"
        action={
          <form action={markAllReadAction}>
            <Button variant="secondary" type="submit">
              모두 읽음
            </Button>
          </form>
        }
      />
      <Tabs active={f} items={FILTERS.map((x) => ({ ...x, href: `/notifications?f=${x.key}` }))} />
      <Card className="overflow-hidden">
        {rows.length ? (
          <div className="divide-y divide-border">
            {rows.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </div>
        ) : (
          <EmptyState title="알림이 없습니다" desc="새 실거래·신고가·관련 뉴스·주변 청약이 생기면 여기에 표시됩니다." />
        )}
      </Card>
    </div>
  );
}
