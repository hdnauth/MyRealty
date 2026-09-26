// 표시용 포맷터 (서버·클라이언트 공용)

export const M2_PER_PYEONG = 3.305785;

/** 만원 단위 금액 → "27억 5,000만" */
export function formatManwon(v: number | null | undefined, opts: { short?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(Math.round(v));
  const eok = Math.floor(a / 10000);
  const man = a % 10000;
  if (opts.short) {
    if (eok >= 1) return `${sign}${Number((a / 10000).toFixed(a >= 100000 ? 1 : 2))}억`;
    return `${sign}${man.toLocaleString("ko-KR")}만`;
  }
  if (eok && man) return `${sign}${eok.toLocaleString("ko-KR")}억 ${man.toLocaleString("ko-KR")}만`;
  if (eok) return `${sign}${eok.toLocaleString("ko-KR")}억`;
  return `${sign}${man.toLocaleString("ko-KR")}만`;
}

export function toPyeong(m2: number | null | undefined): number | null {
  if (!m2) return null;
  return m2 / M2_PER_PYEONG;
}

export function formatArea(m2: number | null | undefined): string {
  if (!m2) return "-";
  return `${Number(m2).toFixed(1)}㎡ (${toPyeong(m2)!.toFixed(1)}평)`;
}

/** 평당가(만원) */
export function perPyeong(price: number | null | undefined, m2: number | null | undefined): number | null {
  if (!price || !m2) return null;
  return price / toPyeong(m2)!;
}

export function formatPct(v: number | null | undefined, digits = 1, withSign = true): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  const s = (v * 100).toFixed(digits);
  return `${withSign && v > 0 ? "+" : ""}${s}%`;
}

export function formatNumber(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return v.toLocaleString("ko-KR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatDate(d: string | Date | null | undefined, style: "short" | "long" = "short"): string {
  if (!d) return "-";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "-";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return style === "short" ? `${String(y).slice(2)}.${m}.${day}` : `${y}.${m}.${day}`;
}

export function timeAgo(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const s = (Date.now() - dt.getTime()) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return formatDate(dt);
}

/** 상승=빨강, 하락=파랑 (국내 시세 표기 관례) */
export function changeTone(v: number | null | undefined): "up" | "down" | "flat" {
  if (!v || Math.abs(v) < 1e-9) return "flat";
  return v > 0 ? "up" : "down";
}

/** 외부 데이터에서 온 링크는 http(s) 또는 앱 내부 경로만 허용 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  return /^https?:\/\//i.test(url) ? url : null;
}
