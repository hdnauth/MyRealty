/**
 * 글자 크기(서버·브라우저 공용): 보통 · 크게(기본) · 더 크게. 기기별로 쿠키에 저장한다(화면 테마와 같은 방식, lib/theme).
 * 화면의 글자·여백은 rem 이라 <html> 글자 크기 하나로 함께 커진다. 기본(크게)이면 속성을 뺀다.
 */
export const FONT_COOKIE = "fontsize";
export type FontSize = "normal" | "large" | "xlarge";
export const FONT_SIZES: { value: FontSize; label: string; desc: string }[] = [
  { value: "normal", label: "보통", desc: "한 화면에 더 많이" },
  { value: "large", label: "크게", desc: "기본" },
  { value: "xlarge", label: "더 크게", desc: "읽기 편하게" },
];

export function isFontSize(v: unknown): v is FontSize {
  return v === "normal" || v === "large" || v === "xlarge";
}

/** 첫 페인트 전 인라인 스크립트(깜빡임 방지): 쿠키 값을 <html data-font> 에 반영 */
export const FONT_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${FONT_COOKIE}=(normal|xlarge)/);if(m)document.documentElement.dataset.font=m[1];}catch(e){}})();`;

export function applyFontSize(f: FontSize) {
  const root = document.documentElement;
  if (f === "large") delete root.dataset.font;
  else root.dataset.font = f;
  document.cookie = `${FONT_COOKIE}=${f}; path=/; max-age=${60 * 60 * 24 * 365 * 2}; samesite=lax`;
}

export function readFontCookie(): FontSize {
  const m = typeof document !== "undefined" ? document.cookie.match(new RegExp(`(?:^|; )${FONT_COOKIE}=(\\w+)`)) : null;
  return isFontSize(m?.[1]) ? (m![1] as FontSize) : "large";
}
