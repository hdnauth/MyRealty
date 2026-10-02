import Link from "next/link";

/** 로그인 없이 볼 수 있는 법적 고지(앱 마켓 등록에 공개 URL 이 필요하다) */
export default function LegalLayout({ children }: LayoutProps<"/legal">) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/" className="mb-6 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" className="h-8 w-8" />
        <span className="font-bold">마이리얼티</span>
      </Link>
      <article className="legal space-y-4 text-[15px] leading-relaxed">{children}</article>
      <nav className="mt-10 flex flex-wrap gap-4 border-t border-border pt-4 text-sm text-muted">
        <Link href="/legal/privacy" className="hover:text-accent">개인정보처리방침</Link>
        <Link href="/legal/terms" className="hover:text-accent">이용약관</Link>
        <Link href="/legal/account-deletion" className="hover:text-accent">계정 삭제</Link>
      </nav>
    </div>
  );
}
