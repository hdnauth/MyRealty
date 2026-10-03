import { ChevronRight, Settings, ShieldCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { navSections } from "@/components/shell/nav-config";
import { ThemeToggle } from "@/components/shell/theme-picker";
import { Card, LinkButton } from "@/components/ui";
import { getUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "전체 메뉴" };

/** 모바일 "전체" 탭: 모든 기능 한눈에 + 계정 */
export default async function MenuPage() {
  const user = await getUser();
  const sections = navSections((user?.itemCount ?? 0) > 0);
  const member = user?.email ? { ...user, email: user.email } : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {member ? (
        <Link href="/settings" className="card flex items-center gap-3 p-4 hover:border-accent/40">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold uppercase text-accent">
            {member.email[0]}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{member.email}</span>
            <span className="text-xs text-muted">계정 · 알림 · 기기 관리</span>
          </span>
          <ChevronRight size={18} className="text-muted" />
        </Link>
      ) : (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
              <UserRound size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{user ? "게스트로 이용 중" : "둘러보는 중"}</p>
              <p className="text-xs text-muted">
                {user ? `관심 부동산 ${user.itemCount}개가 이 기기에 저장되어 있어요` : "관심 부동산을 등록하면 이 기기에 저장됩니다"}
              </p>
            </div>
          </div>
          <LinkButton href="/login" className="mt-3 w-full">이메일로 간편 가입 · 로그인</LinkButton>
          <p className="mt-2 text-center text-xs text-muted">가입하면 글쓰기·AI 질문·이메일 요약·다른 기기 동기화를 쓸 수 있어요</p>
        </Card>
      )}

      {sections.map((s, i) => (
        <section key={i}>
          <h2 className="mb-2 px-1 text-[13px] font-semibold text-muted">{s.title ?? "바로가기"}</h2>
          <Card className="grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-3">
            {s.items.map(({ href, label, icon: Icon, desc, member: needs }) => (
              <Link key={href + label} href={href} className="flex items-start gap-3 bg-surface p-3.5 hover:bg-surface-2">
                <Icon size={20} className="mt-0.5 shrink-0 text-accent" strokeWidth={1.9} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-[15px] font-medium">
                    {label}
                    {needs && !member ? <span className="rounded bg-surface-2 px-1 text-[10px] font-medium text-muted">가입</span> : null}
                  </span>
                  {desc ? <span className="block truncate text-xs text-muted">{desc}</span> : null}
                </span>
              </Link>
            ))}
          </Card>
        </section>
      ))}

      <Card className="divide-y divide-border">
        <Link href="/settings" className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
          <Settings size={18} className="text-muted" />
          <span className="flex-1">설정</span>
          <ChevronRight size={16} className="text-muted" />
        </Link>
        {user?.isAdmin ? (
          <Link href="/admin" className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
            <ShieldCheck size={18} className="text-muted" />
            <span className="flex-1">관리</span>
            <ChevronRight size={16} className="text-muted" />
          </Link>
        ) : null}
        <div className="flex items-center gap-3 px-4 py-2">
          <span className="flex-1 text-sm text-muted">화면 테마</span>
          <ThemeToggle />
        </div>
      </Card>

      <nav className="flex flex-wrap gap-4 px-1 text-xs text-muted">
        <Link href="/legal/terms" className="hover:text-accent">이용약관</Link>
        <Link href="/legal/privacy" className="hover:text-accent">개인정보처리방침</Link>
        <Link href="/community/rules" className="hover:text-accent">동네 이야기 운영 원칙</Link>
      </nav>
    </div>
  );
}
