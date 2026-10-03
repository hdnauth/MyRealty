import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui";
import type { Answer, Evidence, Tone } from "@/lib/brief";

const DOT: Record<Tone, string> = {
  good: "bg-ok",
  bad: "bg-up",
  warn: "bg-warn",
  up: "bg-up",
  down: "bg-down",
  neutral: "bg-accent",
  empty: "border border-dashed border-muted bg-transparent",
};

// 가격 방향(up/down)은 점 색으로만 — 문장까지 칠하면 경고처럼 읽힌다. 안전·위험 판정만 글자에 색을 남긴다
const HEAD: Record<Tone, string> = {
  good: "text-ok",
  bad: "text-up",
  warn: "text-warn",
  up: "",
  down: "",
  neutral: "",
  empty: "text-muted font-medium",
};

/**
 * 다섯 질문 요약 카드. 각 줄은 질문 · 한 줄 답 · 근거(필요하면 신뢰도) 순이고, 근거 화면으로 이어진다.
 * slots: 답하려면 입력이 필요한 줄 아래에 넣을 폼(예: 내 자금)
 */
export function BriefCard({
  answers,
  links,
  title = "한눈에 보기",
  sub,
  slots,
  footer,
}: {
  answers: Answer[];
  links: Partial<Record<Evidence, string>>;
  title?: string;
  sub?: ReactNode;
  slots?: Partial<Record<NonNullable<Answer["need"]>, ReactNode>>;
  footer?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} sub={sub} />
      <ul className="divide-y divide-border">
        {answers.map((a) => {
          const href = a.evidence ? links[a.evidence] : undefined;
          const slot = a.need ? slots?.[a.need] : undefined;
          return (
            <li key={a.key} className="px-4 py-3" data-question={a.key}>
              <div className="flex items-start gap-3">
                <span className={clsx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", DOT[a.tone])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted">{a.q}</span>
                    {href && !slot ? (
                      <Link href={href} scroll={href.includes("#") ? undefined : false} className="flex shrink-0 items-center text-xs text-accent">
                        {a.need ? "입력" : "근거"}
                        <ChevronRight size={14} />
                      </Link>
                    ) : null}
                  </div>
                  <p className={clsx("mt-0.5 text-sm font-semibold leading-snug", HEAD[a.tone])}>{a.headline}</p>
                  {a.detail ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{a.detail}</p> : null}
                  {a.trust ? <p className="mt-1 text-[0.75rem] leading-relaxed text-muted">ⓘ {a.trust}</p> : null}
                  {slot ? <div className="mt-2">{slot}</div> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {footer ? <div className="border-t border-border px-4 py-2 text-[0.75rem] text-muted">{footer}</div> : null}
    </Card>
  );
}
