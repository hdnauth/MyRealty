import { BottomTabs, MobileTopBar, Sidebar } from "@/components/shell/nav";
import { ServiceWorkerRegister } from "@/components/shell/sw-register";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { getSiteSettings } from "@/lib/site-settings";

// 로그인 사용자 전용 화면이라 항상 요청 시 렌더링한다. 빌드 때 미리 렌더링을 시도하면 DB 쿼리를 기다리느라
// 배포 빌드가 멈출 수 있다(예: /admin/system 60초 초과로 빌드 실패).
export const dynamic = "force-dynamic";

export default async function MainLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [[{ n }], site] = await Promise.all([
    sql<{ n: number }[]>`select count(*)::int as n from notifications where user_id = ${user.id} and read_at is null`,
    getSiteSettings(),
  ]);
  return (
    <div className="flex min-h-dvh">
      <Sidebar unread={n} email={user.email} isAdmin={user.isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar unread={n} />
        {site.notice ? (
          <div role="note" className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-sm text-text lg:px-8">
            {site.notice}
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-4 lg:px-8 lg:pb-10 lg:pt-8">{children}</main>
        <BottomTabs />
      </div>
      <ServiceWorkerRegister />
    </div>
  );
}
