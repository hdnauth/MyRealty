"use client";

import clsx from "clsx";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TypeIcon } from "@/components/items/item-card";
import { shortAddress } from "@/lib/format";
import { GROUP_TAGS, PROPERTY_TYPES, type PropertyType } from "@/lib/property";

export type SwitcherItem = { id: string; label: string; property_type: PropertyType; group_tag: string };

/**
 * 상세 화면 제목 옆: 다른 관심 부동산으로 바로 옮겨 간다(보던 탭 유지). 이전/다음 버튼, ←/→ 키(입력 중이 아닐 때)도 지원.
 * 목록은 그룹(보유·매수 후보·관심·전월세) 순.
 */
export function ItemSwitcher({ items, currentId, tab }: { items: SwitcherItem[]; currentId: string; tab: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const idx = items.findIndex((i) => i.id === currentId);
  const href = (id: string) => `/items/${id}${tab && tab !== "overview" ? `?tab=${tab}` : ""}`;
  const prev = items.length > 1 ? items[(idx - 1 + items.length) % items.length] : null;
  const next = items.length > 1 ? items[(idx + 1) % items.length] : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // ←/→ 로 이전·다음 부동산(입력 칸·메모 작성 중에는 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey || !t || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      if (e.key === "ArrowLeft" && prev) router.push(href(prev.id));
      if (e.key === "ArrowRight" && next) router.push(href(next.id));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (items.length < 2) return null;
  const groups = Object.keys(GROUP_TAGS).filter((g) => items.some((i) => i.group_tag === g));
  const others = items.filter((i) => !(i.group_tag in GROUP_TAGS));

  return (
    <div ref={box} className="relative flex shrink-0 items-center">
      {prev ? (
        <Link href={href(prev.id)} aria-label={`이전: ${prev.label}`} title={`이전: ${shortAddress(prev.label)} (←)`} className="hidden rounded-lg p-1.5 text-muted hover:bg-surface-2 sm:block">
          <ChevronLeft size={16} />
        </Link>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
      >
        <span className="tabular">
          {idx + 1}/{items.length}
        </span>
        <span className="hidden sm:inline">다른 부동산</span>
        <ChevronDown size={14} className={clsx("transition", open && "rotate-180")} />
      </button>
      {next ? (
        <Link href={href(next.id)} aria-label={`다음: ${next.label}`} title={`다음: ${shortAddress(next.label)} (→)`} className="hidden rounded-lg p-1.5 text-muted hover:bg-surface-2 sm:block">
          <ChevronRight size={16} />
        </Link>
      ) : null}
      {open ? (
        <div
          role="listbox"
          className="fixed inset-x-4 top-32 z-50 max-h-[65vh] overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-lg sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-1 sm:w-80"
        >
          {[...groups.map((g) => [g, items.filter((i) => i.group_tag === g)] as const), ...(others.length ? [["", others] as const] : [])].map(([g, list]) => (
            <div key={g || "etc"}>
              {g ? <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted">{GROUP_TAGS[g as keyof typeof GROUP_TAGS]}</div> : null}
              {list.map((i) => (
                <Link
                  key={i.id}
                  href={href(i.id)}
                  role="option"
                  aria-selected={i.id === currentId}
                  onClick={() => setOpen(false)}
                  className={clsx("flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2", i.id === currentId && "bg-accent-soft/60 font-medium text-accent")}
                >
                  <span className="text-muted">
                    <TypeIcon type={i.property_type} size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{shortAddress(i.label)}</span>
                  <span className="shrink-0 text-[11px] text-muted">{PROPERTY_TYPES[i.property_type]?.label}</span>
                  {i.id === currentId ? <Check size={14} className="shrink-0" /> : null}
                </Link>
              ))}
            </div>
          ))}
          <Link href="/items/new" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 border-t border-border px-3 py-2 text-sm text-accent hover:bg-surface-2">
            <Plus size={15} /> 새로 등록
          </Link>
        </div>
      ) : null}
    </div>
  );
}
