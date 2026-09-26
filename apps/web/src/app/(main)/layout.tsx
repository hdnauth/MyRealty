import { BottomTabs, MobileTopBar, Sidebar } from "@/components/shell/nav";
import { ServiceWorkerRegister } from "@/components/shell/sw-register";
import { requireUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export default async function MainLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from notifications where user_id = ${user.id} and read_at is null`;
  return (
    <div className="flex min-h-dvh">
      <Sidebar unread={n} email={user.email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar unread={n} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-4 lg:px-8 lg:pb-10 lg:pt-8">{children}</main>
        <BottomTabs />
      </div>
      <ServiceWorkerRegister />
    </div>
  );
}
