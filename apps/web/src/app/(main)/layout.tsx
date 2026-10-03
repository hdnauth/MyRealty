import { BottomTabs, MobileTopBar, type ShellViewer, Sidebar } from "@/components/shell/nav";
import { ServiceWorkerRegister } from "@/components/shell/sw-register";
import { getUser } from "@/lib/auth/session";
import { getSiteSettings } from "@/lib/site-settings";

// 사용자마다 다른 화면이라 항상 요청 시 렌더링한다. 빌드 때 미리 렌더링을 시도하면 DB 쿼리를 기다리느라
// 배포 빌드가 멈출 수 있다(예: /admin/system 60초 초과로 빌드 실패).
export const dynamic = "force-dynamic";

export default async function MainLayout({ children }: LayoutProps<"/">) {
  // 로그인하지 않은 방문자도 모든 화면을 볼 수 있다(저장 시 기기 게스트, 글쓰기·AI 는 가입)
  const [user, site] = await Promise.all([getUser(), getSiteSettings()]);
  const viewer: ShellViewer = user
    ? { email: user.email, isGuest: user.isGuest, isAdmin: user.isAdmin, unread: user.unread, itemCount: user.itemCount }
    : null;
  return (
    <div className="flex min-h-dvh">
      <Sidebar viewer={viewer} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar viewer={viewer} />
        {site.notice ? (
          <div role="note" className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-sm text-text lg:px-8">
            {site.notice}
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-4 lg:px-8 lg:pb-10 lg:pt-8">{children}</main>
        <BottomTabs viewer={viewer} />
      </div>
      <ServiceWorkerRegister />
    </div>
  );
}
