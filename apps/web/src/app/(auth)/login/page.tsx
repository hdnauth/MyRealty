import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "로그인" };

export default async function LoginPage(props: PageProps<"/login">) {
  if (await getUser()) redirect("/");
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
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
