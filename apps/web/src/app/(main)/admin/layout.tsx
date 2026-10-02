import type { Metadata } from "next";
import { Badge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/session";
import { AdminTabs } from "./admin-tabs";

export const metadata: Metadata = { title: { default: "관리", template: "%s · 관리 · 마이리얼티" } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">관리</h1>
        <Badge tone="warn">관리자</Badge>
        <span className="ml-auto truncate text-xs text-muted">{admin.email}</span>
      </div>
      <AdminTabs />
      {children}
    </div>
  );
}
