/** 차트 시간축·기간 선택 공통(서버·클라이언트 어디서나, 순수 함수) */

export const RANGES = [
  { key: "1y", label: "1년", months: 12 },
  { key: "3y", label: "3년", months: 36 },
  { key: "5y", label: "5년", months: 60 },
  { key: "10y", label: "10년", months: 120 },
  { key: "all", label: "전체", months: null },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

/** 기간의 시작일(YYYY-MM-DD). 전체면 null */
export function rangeSince(key: RangeKey, now = new Date()): string | null {
  const months = RANGES.find((r) => r.key === key)?.months ?? null;
  if (months === null) return null;
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  // toISOString 은 UTC 라 한국 시간 새벽에는 하루 밀린다 — 로컬 날짜로
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 데이터가 실제로 걸친 기간보다 짧은 선택지만(+전체) 보여 준다 — 2년치 자료에 5년·10년 버튼은 의미가 없다.
 * firstDate 가 없으면(빈 자료) 빈 목록.
 */
export function rangeOptions(firstDate: string | null | undefined, now = new Date()): RangeKey[] {
  if (!firstDate) return [];
  const first = new Date(firstDate);
  if (Number.isNaN(first.getTime())) return [];
  const spanMonths = (now.getFullYear() - first.getFullYear()) * 12 + (now.getMonth() - first.getMonth());
  const keys = RANGES.filter((r) => r.months !== null && r.months < spanMonths).map((r) => r.key);
  return keys.length ? [...keys, "all"] : [];
}

/** 기본 기간: 원하는 기간이 선택지에 없으면(자료가 더 짧으면) 전체 */
export function defaultRange(options: RangeKey[], wanted: RangeKey): RangeKey {
  return options.includes(wanted) ? wanted : "all";
}

/**
 * 시간축 라벨: 1월은 굵은 "2025년", 그 밖의 달은 "24년 4월"(눈금이 1월에 오지 않아도 어느 해인지 늘 보이게).
 * 일 단위 눈금(기간이 아주 짧을 때)은 "4.15".
 */
export function timeLabel(value: number): string {
  const d = new Date(value);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (d.getDate() !== 1) return `${m}.${d.getDate()}`;
  if (m === 1) return `{y|${y}년}`;
  return `${String(y).slice(2)}년 ${m}월`;
}

/** 툴팁 머리: "2025년 3월"(일 단위 값이면 "2025년 3월 15일") */
export function periodLabel(v: string | number | Date, withDay = false): string {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월${withDay ? ` ${d.getDate()}일` : ""}`;
}
