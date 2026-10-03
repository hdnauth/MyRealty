"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** 단지 상세에서 입지 점수가 아직 없을 때: 화면을 연 김에 즉석 계산을 요청하고, 끝나면 화면을 다시 그린다 */
export function LocationLoader({ complexId }: { complexId: number }) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "failed">("loading");
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/map/location?ids=${complexId}&priority=1`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { scores: Record<string, unknown> }) => {
        if (d.scores[complexId]) router.refresh();
        else setState("failed");
      })
      .catch(() => {
        if (!ctl.signal.aborted) setState("failed");
      });
    return () => ctl.abort();
  }, [complexId, router]);
  return state === "loading" ? (
    <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
      <Loader2 size={16} className="animate-spin" /> 주변 역·학교·공원을 살펴 점수를 계산하고 있어요…
    </p>
  ) : (
    <p className="mt-2 text-sm text-muted">지금은 주변 시설을 불러오지 못했어요. 매일 아침 수집 뒤 표시됩니다.</p>
  );
}
