import { Bell, Check, MessagesSquare, Sparkles, Smartphone, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/policy";
import { getUser } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "간편 가입 · 로그인" };

const BENEFITS = [
  { icon: Smartphone, text: "다른 기기에서도 내 관심 부동산·설정 그대로" },
  { icon: MessagesSquare, text: "동네 이야기 글쓰기·댓글·가격 전망 투표" },
  { icon: Sparkles, text: "AI 질문하기·분석 카드·주간 리포트" },
  { icon: Bell, text: "아침 이메일 요약(신고가·새 거래·뉴스)" },
];

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = safeNext(sp.next);
  // 이미 가입한 기기면 바로 들어간다. DB 장애 시에도 로그인 화면은 보여준다.
  const user = await getUser().catch((e) => {
    console.error("[login] 세션 확인 실패", e);
    return null;
  });
  if (user && !user.isGuest) redirect(next);
  const [saved] = user
    ? await sql<{ n: number }[]>`select count(*)::int as n from watch_items where user_id = ${user.id}`.catch(() => [{ n: 0 }])
    : [{ n: 0 }];
  const needMember = sp.why === "member";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-3 flex justify-end">
          <Link href={next} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted hover:bg-surface-2" aria-label="가입 없이 둘러보기">
            가입 없이 둘러보기 <X size={16} />
          </Link>
        </div>
        <div className="card p-6">
          <div className="mb-5 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon.svg" alt="" className="h-10 w-10" />
            <div>
              <h1 className="text-lg font-bold tracking-tight">이메일로 간편 가입</h1>
              <p className="text-xs text-muted">비밀번호 없이 6자리 코드로 가입·로그인</p>
            </div>
          </div>

          {needMember ? (
            <p className="mb-4 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
              이 기능은 가입 후 이용할 수 있어요. 이메일 확인만 하면 바로 이어서 쓸 수 있습니다.
            </p>
          ) : null}

          <LoginForm next={next} />

          {saved.n > 0 ? (
            <p className="mt-4 flex items-start gap-1.5 text-xs text-muted">
              <Check size={14} className="mt-0.5 shrink-0 text-ok" />이 기기에 저장한 관심 부동산 {saved.n}개는 가입·로그인 후에도 그대로 이어집니다.
            </p>
          ) : null}
        </div>

        <ul className="mt-5 space-y-2 px-1 text-sm">
          {BENEFITS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5 text-muted">
              <Icon size={16} className="shrink-0 text-accent" />
              {text}
            </li>
          ))}
        </ul>
        <p className="mt-4 px-1 text-xs leading-relaxed text-muted">
          가입하지 않아도 지도·시세·지표·동네 이야기 읽기, 관심 부동산 등록(이 기기에 저장)은 그대로 쓸 수 있습니다.
        </p>
        <p className="mt-6 text-center text-xs text-muted">
          계속하면 <Link href="/legal/terms" className="underline">이용약관</Link>과{" "}
          <Link href="/legal/privacy" className="underline">개인정보처리방침</Link>에 동의하는 것으로 봅니다.
        </p>
      </div>
    </div>
  );
}
