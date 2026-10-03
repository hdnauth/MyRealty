"use client";

import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyFontSize, FONT_SIZES, type FontSize, readFontCookie } from "@/lib/font-size";
import { applyTheme, readThemeCookie, type Theme, THEMES } from "@/lib/theme";

const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

function useTheme(): [Theme | null, (t: Theme) => void] {
  // 서버 렌더에는 쿠키 값을 모르므로(정적 페이지 유지) 마운트 뒤에 읽는다
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 쿠키는 마운트 뒤에만 읽을 수 있다
    setTheme(readThemeCookie());
  }, []);
  return [
    theme,
    (t: Theme) => {
      applyTheme(t);
      setTheme(t);
    },
  ];
}

/** 설정 화면: 시스템·라이트·다크 세 칸 */
export function ThemePicker() {
  const [theme, set] = useTheme();
  return (
    <div className="grid grid-cols-3 gap-2 px-4 pb-4" role="radiogroup" aria-label="화면 테마">
      {THEMES.map((t) => {
        const I = ICON[t.value];
        const on = theme === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => set(t.value)}
            className={clsx("rounded-lg border px-3 py-2 text-left", on ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}
          >
            <span className={clsx("flex items-center gap-1.5 text-sm font-semibold", on && "text-accent")}>
              <I size={15} /> {t.label}
            </span>
            <span className="block text-xs text-muted">{t.desc}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 사이드바·상단바: 누를 때마다 시스템 → 라이트 → 다크 */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, set] = useTheme();
  const cur = theme ?? "system";
  const next: Theme = cur === "system" ? "light" : cur === "light" ? "dark" : "system";
  const I = ICON[cur];
  const label = THEMES.find((t) => t.value === cur)!.label;
  return (
    <button
      type="button"
      onClick={() => set(next)}
      aria-label={`화면 테마: ${label} (누르면 ${THEMES.find((t) => t.value === next)!.label})`}
      title={`화면 테마: ${label}`}
      className={clsx("rounded-lg p-2 text-muted hover:bg-surface-2", className)}
    >
      <I size={18} />
    </button>
  );
}

/** 설정 화면: 글자 크기 세 칸(보통·크게·더 크게) — 누르면 바로 바뀐다 */
export function FontSizePicker() {
  const [size, setSize] = useState<FontSize | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 쿠키는 마운트 뒤에만 읽을 수 있다
    setSize(readFontCookie());
  }, []);
  return (
    <div className="grid grid-cols-3 gap-2 px-4 pb-4" role="radiogroup" aria-label="글자 크기">
      {FONT_SIZES.map((f, i) => {
        const on = size === f.value;
        return (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              applyFontSize(f.value);
              setSize(f.value);
            }}
            className={clsx("rounded-lg border px-3 py-2 text-left", on ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")}
          >
            <span className={clsx("flex items-baseline gap-1.5 font-semibold", on && "text-accent")}>
              <span aria-hidden style={{ fontSize: `${0.9 + i * 0.2}rem` }}>가</span> {f.label}
            </span>
            <span className="block text-xs text-muted">{f.desc}</span>
          </button>
        );
      })}
    </div>
  );
}
