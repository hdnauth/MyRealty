"use client";

import { HelpCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

/** 지표 이름 + ? 버튼: 누르면 계산식과 읽는 법을 보여 준다(바깥을 누르거나 Esc 로 닫힘) */
export function Term({ k, children }: { k: GlossaryKey; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex items-center gap-0.5">
      {children}
      <button
        type="button"
        aria-label={`${typeof children === "string" ? children : "용어"} 설명`}
        aria-expanded={open}
        onClick={(e) => {
          // 화면 오른쪽 절반이면 오른쪽 끝에 맞춰 화면 밖으로 나가지 않게
          setAlignRight(e.currentTarget.getBoundingClientRect().left > window.innerWidth / 2);
          setOpen((v) => !v);
        }}
        className="rounded p-0.5 text-muted hover:text-accent"
      >
        <HelpCircle size={12} />
      </button>
      {open ? (
        <span role="tooltip" className={`absolute ${alignRight ? "right-0" : "left-0"} top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-2.5 text-xs font-normal leading-relaxed text-text shadow-lg`}>
          {GLOSSARY[k]}
        </span>
      ) : null}
    </span>
  );
}
