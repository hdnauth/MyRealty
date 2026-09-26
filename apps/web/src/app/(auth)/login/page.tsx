import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/policy";
import { getUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "로그인" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = safeNext(sp.next);
  // 기억된 기기면 바로 들어간다. DB 장애 시에도 로그인 화면은 보여준다.
  const user = await getUser().catch((e) => {
    console.error("[login] 세션 확인 실패", e);
    return null;
  });
  if (user) redirect(next);
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon.svg" alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-bold">MyRealty</h1>
            <p className="text-xs text-muted">나만을 위한 부동산 인텔리전스</p>
          </div>
        </div>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
