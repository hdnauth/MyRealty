import Link from "next/link";
import { Notice } from "@/components/ui";

/** AI 를 쓸 수 없을 때(설정 없음·키 해독 실패 등) 설정 화면으로 안내 */
export function AiSetupNotice({ problem }: { problem: string | null }) {
  return (
    <Notice tone="warn">
      {problem ?? "AI 설정이 없습니다. 제공자(Claude·GPT·Gemini·DeepSeek·MiMo·Ollama)와 모델·API 키를 등록하면 사용할 수 있습니다."}{" "}
      <Link href="/settings#ai" className="font-semibold underline">
        AI 모델 설정
      </Link>
    </Notice>
  );
}
