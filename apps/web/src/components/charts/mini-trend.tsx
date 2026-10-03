/**
 * 아주 작은 추세선(SVG, 서버에서 그린다) — 목록 카드처럼 여러 개를 한 화면에 둘 때 차트 라이브러리를 띄우지 않는다.
 * 마지막 점은 동그라미로 강조. 점이 2개 미만이면 그리지 않는다.
 */
export function MiniTrend({
  points,
  width = 72,
  height = 28,
  className,
  stretch = false,
}: {
  points: [string, number][];
  width?: number;
  height?: number;
  className?: string;
  /** 부모 폭에 맞춰 가로로 늘린다(선 굵기는 그대로) */
  stretch?: boolean;
}) {
  if (points.length < 2) return null;
  const ys = points.map((p) => p[1]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const pad = 3;
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => (hi === lo ? height / 2 : pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const last = points.length - 1;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={stretch ? undefined : width}
      height={stretch ? undefined : height}
      preserveAspectRatio={stretch ? "none" : undefined}
      className={className}
      aria-hidden
    >
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={stretch ? 2 : 1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {stretch ? null : <circle cx={x(last)} cy={y(points[last][1])} r={2.5} fill="var(--series-1)" />}
    </svg>
  );
}
