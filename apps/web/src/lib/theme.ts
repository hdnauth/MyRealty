/**
 * 화면 테마(서버·브라우저 공용): 시스템(OS 설정 따라감) · 라이트 · 다크. 기기별로 쿠키에 저장한다.
 * <html data-theme="light|dark"> 가 있으면 OS 설정보다 우선한다(globals.css). 시스템이면 속성을 뺀다.
 */
export const THEME_COOKIE = "theme";
export type Theme = "system" | "light" | "dark";
export const THEMES: { value: Theme; label: string; desc: string }[] = [
  { value: "system", label: "시스템", desc: "기기 설정(다크 모드)에 맞춤" },
  { value: "light", label: "라이트", desc: "밝은 화면" },
  { value: "dark", label: "다크", desc: "어두운 화면" },
];
/** 브라우저 상단 바 색(layout viewport.themeColor 와 같은 값) */
export const THEME_BG = { light: "#f5f6f8", dark: "#0f1115" } as const;

export function isTheme(v: unknown): v is Theme {
  return v === "system" || v === "light" || v === "dark";
}

/**
 * 첫 페인트 전에 실행하는 인라인 스크립트(깜빡임 방지). 쿠키의 테마를 <html data-theme> 와 theme-color 에 반영한다.
 * 정적 페이지(로그인·오프라인)도 그대로 두기 위해 서버에서 쿠키를 읽지 않고 브라우저에서 적용한다.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)/);if(!m)return;var t=m[1];document.documentElement.dataset.theme=t;var c=t==="dark"?"${THEME_BG.dark}":"${THEME_BG.light}";document.querySelectorAll('meta[name="theme-color"]').forEach(function(e){e.setAttribute("content",c)});}catch(e){}})();`;

/** 브라우저에서 테마 적용 + 저장 */
export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
  document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=${60 * 60 * 24 * 365 * 2}; samesite=lax`;
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    // 시스템이면 media 속성대로 두기 위해 원래 값으로 되돌린다
    const media = m.getAttribute("media") ?? "";
    const own = media.includes("dark") ? THEME_BG.dark : media.includes("light") ? THEME_BG.light : null;
    m.setAttribute("content", t === "system" && own ? own : dark ? THEME_BG.dark : THEME_BG.light);
  });
}

export function readThemeCookie(): Theme {
  const m = typeof document !== "undefined" ? document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(\\w+)`)) : null;
  return isTheme(m?.[1]) ? m![1] as Theme : "system";
}
