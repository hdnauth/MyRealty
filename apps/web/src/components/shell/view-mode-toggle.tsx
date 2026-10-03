import { setViewModeAction } from "@/app/(main)/settings/actions";
import type { ViewMode } from "@/lib/view-mode";

/** 기본 보기 ↔ 전문 보기 전환(쿠키). 접어 둔 수치가 있는 화면 아래에 둔다 */
export function ViewModeToggle({ mode, what = "수치·검증 표" }: { mode: ViewMode; what?: string }) {
  return (
    <form action={setViewModeAction} className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted">
      <input type="hidden" name="mode" value={mode === "pro" ? "simple" : "pro"} />
      <span>{mode === "pro" ? "전문 보기: 모든 지표를 펼쳐 보입니다." : `기본 보기: ${what}는 접어 두었습니다.`}</span>
      <button type="submit" className="font-medium text-accent">
        {mode === "pro" ? "기본 보기로" : "전문 보기로"}
      </button>
    </form>
  );
}
