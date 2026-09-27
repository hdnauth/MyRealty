import Link from "next/link";
import { Badge, Card, CardHeader, Stat } from "@/components/ui";
import { type AreaUnit, formatDate, formatManwon, formatNumber, fromPerPyeong, unitPriceLabel } from "@/lib/format";
import { REBUILD_AGE, type Redevelopment, stageGuide } from "@/lib/queries/special";

const ZONE_STAGES = ["기본계획", "정비구역지정", "추진위", "조합설립", "사업시행인가", "관리처분인가", "이주·철거", "착공", "준공"];
const PY = 3.305785;

/**
 * 재개발·재건축 관련 부동산: 소속 구역·단계, 사업성(연한·용적률 여유·대지지분), 주변 신축·분양권 시세와 비교.
 * 권리가액·분담금은 조합 자료가 필요해 계산하지 않고, 판단에 필요한 재료를 모아 보여 준다.
 */
export function RedevelopmentCard({ info, price, unit, itemId }: { info: Redevelopment; price: number | null; unit: AreaUnit; itemId: string }) {
  const z = info.zone;
  const sharePy = info.landShare ? info.landShare.m2 / PY : null;
  const perShare = price && sharePy ? price / sharePy : null;
  const extra = z?.households_plan && z.households_now ? z.households_plan - z.households_now : null;
  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title="재개발·재건축"
        sub={z ? (z.inside ? "이 부동산이 속한 정비구역" : `인접 정비구역(${z.dist_m}m)`) : `준공 ${info.age}년차 — 재건축 연한(${REBUILD_AGE}년) 기준으로 점검`}
        action={<Link href={`/items/${itemId}?tab=location`} className="text-accent">주변 사업</Link>}
      />
      {z ? (
        <div className="px-4 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{z.name}</span>
            <Badge tone="accent">{z.kind}</Badge>
            <span className="text-sm">{z.stage ?? "단계 미상"}</span>
            {z.stage_date ? <span className="text-xs text-muted">{formatDate(z.stage_date)}</span> : null}
          </div>
          <div className="mt-2 flex gap-0.5" aria-label={`${z.stage_order ?? 0}/9 단계`}>
            {ZONE_STAGES.map((s, i) => (
              <div key={s} className="flex-1">
                <div className={`h-1.5 rounded-sm ${i < (z.stage_order ?? 0) ? "bg-accent" : "bg-surface-2"}`} />
                <div className={`mt-1 hidden text-center text-[10px] sm:block ${i + 1 === z.stage_order ? "font-semibold text-accent" : "text-muted"}`}>{s}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed">{stageGuide(z.stage_order)}</p>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4 border-t border-border px-4 py-3 sm:grid-cols-4">
        <Stat
          label="재건축 연한"
          value={info.age === null ? "-" : info.age >= REBUILD_AGE ? "도달" : `${REBUILD_AGE - info.age}년 남음`}
          sub={info.buildYear ? <span className="text-muted">{info.buildYear}년 준공 · {info.age}년차</span> : <span className="text-muted">준공 연도 미상</span>}
        />
        <Stat
          label="용적률 여유"
          value={info.far ? `${info.far.cap - info.far.current > 0 ? "+" : ""}${Math.round(info.far.cap - info.far.current)}%p` : "-"}
          sub={info.far ? <span className="text-muted">현재 {Math.round(info.far.current)}% / {info.far.zone} {info.far.cap}%</span> : <span className="text-muted">건축물대장·용도지역 필요</span>}
        />
        <Stat
          label="대지지분"
          value={info.landShare ? `${formatNumber(Math.round(info.landShare.m2 * 10) / 10)}㎡` : "-"}
          sub={info.landShare ? <span className="text-muted">{(info.landShare.m2 / PY).toFixed(1)}평 · {info.landShare.basis}</span> : <span className="text-muted">대장·거래 자료 없음</span>}
        />
        <Stat
          label="대지지분 평당가"
          value={perShare ? formatManwon(perShare, { short: true }) : "-"}
          sub={<span className="text-muted">{price ? `시세 ${formatManwon(price, { short: true })} ÷ 지분` : "시세 필요"}</span>}
        />
        {z ? (
          <Stat
            label="세대수 변화"
            value={z.households_plan ? `${z.households_plan.toLocaleString()}세대` : "-"}
            sub={<span className="text-muted">{z.households_now ? `현재 ${z.households_now.toLocaleString()}` : "현재 세대 미상"}{extra !== null ? ` · 증가 ${extra.toLocaleString()}(일반분양 재원)` : ""}</span>}
          />
        ) : null}
        <Stat
          label={`주변 신축 ${unitPriceLabel(unit)}`}
          value={info.newBuild ? formatManwon(fromPerPyeong(info.newBuild.ppy, unit), { short: true }) : "-"}
          sub={<span className="text-muted">{info.newBuild ? `준공 10년 내 ${info.newBuild.complexes}개 단지 · ${info.newBuild.n}건` : "주변 신축 거래 없음"}</span>}
        />
        <Stat
          label={`분양권·입주권 ${unitPriceLabel(unit)}`}
          value={info.presale?.ppy ? formatManwon(fromPerPyeong(info.presale.ppy, unit), { short: true }) : "-"}
          sub={<span className="text-muted">{info.presale ? `최근 1년 ${info.presale.n}건` : "주변 거래 없음"}</span>}
        />
      </div>
      <p className="px-4 pb-4 text-[11px] leading-relaxed text-muted">
        대지지분 평당가는 같은 구역 안 다른 매물과 비교할 때, 주변 신축·분양권 평당가는 완공 후 가치를 가늠할 때 씁니다. 실제 권리가액·분담금은 감정평가와
        관리처분계획으로 정해지므로 조합 공지를 확인하세요. 용적률 상한은 서울시 조례 기준 참고값입니다.
      </p>
    </Card>
  );
}
