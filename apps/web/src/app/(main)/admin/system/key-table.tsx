import clsx from "clsx";
import { Badge } from "@/components/ui";
import type { KeyCheck, KeyStatus } from "@/lib/keycheck";

const TONE: Record<KeyStatus, "ok" | "up" | "warn" | "neutral"> = {
  ok: "ok",
  missing: "up",
  error: "up",
  warn: "warn",
  optional: "neutral",
  unchecked: "neutral",
};
const LABEL: Record<KeyStatus, string> = {
  ok: "정상",
  missing: "미설정(필수)",
  error: "오류",
  warn: "확인 필요",
  optional: "미설정(선택)",
  unchecked: "설정됨",
};

/** 웹(Vercel) · GitHub Actions(ETL) 키 상태를 한 줄에 나란히. 지문이 둘 다 있으면 같은 키인지 표시 */
export function KeyTable({ web, github }: { web: KeyCheck[]; github: KeyCheck[] | null }) {
  const keys = [...new Set([...web.map((w) => w.key), ...(github ?? []).map((g) => g.key)])];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-4 py-2 font-medium">항목</th>
            <th className="px-2 py-2 font-medium">웹(Vercel)</th>
            <th className="px-2 py-2 font-medium">GitHub Actions(ETL)</th>
            <th className="px-4 py-2 font-medium">같은 키?</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {keys.map((k) => {
            const w = web.find((x) => x.key === k);
            const g = github?.find((x) => x.key === k);
            const same = w?.fp && g?.fp ? w.fp === g.fp : null;
            return (
              <tr key={k} className="align-top">
                <td className="px-4 py-2">
                  {w?.label ?? g?.label}
                  <span className="block font-mono text-[0.75rem] text-muted">{k}</span>
                </td>
                <td className="px-2 py-2">{w ? <Cell c={w} /> : <span className="text-xs text-muted">웹에서 쓰지 않음</span>}</td>
                <td className="px-2 py-2">
                  {g ? <Cell c={g} /> : <span className="text-xs text-muted">{github ? "ETL 에서 쓰지 않음" : "점검 기록 없음"}</span>}
                </td>
                <td className="px-4 py-2 text-xs">
                  {same === null ? (
                    <span className="text-muted">-</span>
                  ) : (
                    <span className={clsx("font-medium", same ? "text-ok" : "text-up")}>{same ? "같음" : "다름"}</span>
                  )}
                  {w?.fp || g?.fp ? (
                    <span className="block font-mono text-[0.75rem] text-muted">
                      {w?.fp ?? "-"} / {g?.fp ?? "-"}
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ c }: { c: KeyCheck }) {
  return (
    <div className="max-w-xs">
      <Badge tone={TONE[c.status]}>{LABEL[c.status]}</Badge>
      {c.detail ? <p className="mt-0.5 text-xs text-muted">{c.detail}</p> : null}
      {c.fix && c.status !== "ok" ? <p className="mt-0.5 text-xs text-text">→ {c.fix}</p> : null}
    </div>
  );
}
