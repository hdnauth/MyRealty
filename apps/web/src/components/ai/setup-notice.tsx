import Link from "next/link";
import { Notice } from "@/components/ui";

/** AI 를 쓸 수 없을 때(서버 AI 꺼짐·내 키 해독 실패 등). 본인 키 연결은 고급 기능이라 뒤에 덧붙인다 */
export function AiSetupNotice({ problem }: { problem: string | null }) {
  return (
    <Notice tone="warn">
      {problem ?? "AI 기능이 아직 준비되지 않았습니다. 사용 중인 AI 서비스(Claude·GPT·Gemini 등)의 키가 있다면 직접 연결해 바로 쓸 수 있어요."}{" "}
      <Link href="/settings#ai" className="font-semibold underline">
        AI 연결 설정
      </Link>
    </Notice>
  );
}

/** 방문자·기기 게스트에게: AI 기능은 이메일 가입 후 */
export function AiSignupNotice({ next }: { next: string }) {
  return (
    <Notice>
      AI 분석·비교는 이메일 간편 가입 후 쓸 수 있어요.{" "}
      <Link href={`/login?next=${encodeURIComponent(next)}&why=member`} className="font-semibold text-accent underline">
        30초 가입하기
      </Link>
    </Notice>
  );
}
