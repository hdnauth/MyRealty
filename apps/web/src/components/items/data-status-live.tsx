"use client";

import { AlertCircle, CheckCircle2, Clock, Loader2, MinusCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { COLLECT_STEPS, type CollectRun, type CollectStepKey, errorNote, finishedSteps, isActive, stepNote } from "@/lib/collect-steps";

export type StatusRow = {
  ok: boolean;
  /** 비어 있으면 화면을 열 때 바로 불러올 핵심 항목 */
  core: boolean;
  step: CollectStepKey;
  label: string;
  ready: string;
  /** 개별 수집을 쓸 수 없을 때(매일 수집 대기) */
  later: string;
  /** 불러왔는데도 없을 때 */
  empty: string;
  href?: string;
};

const POLL_MS = 4000;

/**
 * 데이터 상태 + 개별 수집 진행. 수집 중이면 몇 초마다 진행을 읽고, 단계가 끝날 때마다 화면(서버 컴포넌트)을 새로 그려
 * 채워진 항목부터 보이게 한다.
 */
export function DataStatusLive({
  itemId,
  rows,
  welcome,
  initialRun,
  runnerReady,
  autoStart,
}: {
  itemId: string;
  rows: StatusRow[];
  welcome: boolean;
  initialRun: CollectRun | null;
  runnerReady: boolean;
  autoStart: boolean;
}) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [requesting, setRequesting] = useState(false);
  const seen = useRef(finishedSteps(initialRun));
  const autoDone = useRef(false);

  const request = async (mode: "auto" | "manual") => {
    setRequesting(true);
    try {
      const r = await fetch(`/api/items/${itemId}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const d = await r.json();
      if (d.run) setRun(d.run);
    } catch {
      /* 다음 방문 때 다시 */
    } finally {
      setRequesting(false);
    }
  };

  useEffect(() => {
    if (!autoStart || autoDone.current) return;
    autoDone.current = true;
    void request("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const active = isActive(run);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/items/${itemId}/collect`, { cache: "no-store" });
        const d = await r.json();
        if (stop || !d.run) return;
        setRun(d.run);
        const n = finishedSteps(d.run);
        // 끝난 단계가 늘었거나 실행이 끝나면 새 데이터로 다시 그린다
        if (n > seen.current || !isActive(d.run)) {
          seen.current = n;
          router.refresh();
        }
      } catch {
        /* 네트워크 오류는 다음 주기에 */
      }
    }, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active, itemId, router]);

  const pending = rows.filter((r) => !r.ok);
  const done = finishedSteps(run);
  const ended = run && !active;
  const title = active ? "데이터를 불러오는 중" : welcome ? "등록했습니다" : "아직 채워지지 않은 정보";
  const sub = active
    ? `이 부동산의 공공데이터를 지금 모으고 있습니다(보통 2~5분). 끝난 항목부터 바로 채워집니다 · ${done}/${COLLECT_STEPS.length}`
    : !pending.length
      ? "필요한 정보가 모두 준비됐습니다."
      : run?.status === "error" && !done
        ? `바로 불러오기에 실패했습니다${run.error ? `: ${errorNote(run.error)}` : ""}. 매일 아침(06시 전후) 수집 때 다시 채워집니다.`
        : ended && Object.values(run.steps).some((x) => x?.status === "error")
          ? "불러오기를 마쳤지만 일부 항목은 호출이 실패했습니다(아래 사유). 키를 고친 뒤 다시 불러오거나, 매일 수집 때 다시 시도합니다."
          : ended
          ? "불러오기를 마쳤습니다. 남은 항목은 공공데이터에 자료가 없거나 매일 수집 때 다시 시도합니다."
          : runnerReady
            ? "빈 항목을 바로 불러올 수 있습니다."
            : "빈 항목은 매일 아침(06시 전후) 자동 수집 후 채워집니다. 알림으로 알려 드립니다.";

  return (
    <Card className="mb-4">
      <CardHeader
        title={title}
        sub={sub}
        action={
          runnerReady && !active && pending.length ? (
            <button type="button" disabled={requesting} onClick={() => request("manual")} className="inline-flex items-center gap-1 text-sm text-accent disabled:opacity-50">
              <RefreshCw size={14} className={requesting ? "animate-spin" : undefined} />
              {ended ? "다시 불러오기" : "지금 불러오기"}
            </button>
          ) : null
        }
      />
      {active ? (
        <div className="mx-4 mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(6, (done / COLLECT_STEPS.length) * 100)}%` }} />
        </div>
      ) : null}
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 pb-4 text-sm sm:grid-cols-2">
        {rows.map((r) => {
          const st = run?.steps[r.step];
          const stepEnded = st && st.status !== "running";
          const loading = !r.ok && active && !stepEnded;
          const note = !r.ok && stepEnded ? stepNote(st) : null;
          const failed = !r.ok && stepEnded && st.status === "error";
          const text = r.ok ? r.ready : loading ? "불러오는 중…" : stepEnded ? (note ?? r.empty) : run ? r.empty : r.later;
          return (
            <li key={r.label} className="flex items-start gap-2">
              {r.ok ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" />
              ) : loading ? (
                <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-accent" />
              ) : failed ? (
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-warn" />
              ) : stepEnded ? (
                <MinusCircle size={16} className="mt-0.5 shrink-0 text-muted" />
              ) : (
                <Clock size={16} className="mt-0.5 shrink-0 text-muted" />
              )}
              <span className="min-w-0">
                <span className="font-medium">{r.label}</span>{" "}
                <span className="text-muted">
                  {text}
                  {r.ok && r.href ? (
                    <>
                      {" · "}
                      <Link href={r.href} className="text-accent">
                        보기
                      </Link>
                    </>
                  ) : null}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
