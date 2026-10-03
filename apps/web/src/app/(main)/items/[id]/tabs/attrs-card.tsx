import { Badge, Card, CardHeader } from "@/components/ui";
import { formatManwon, formatNumber, formatPct } from "@/lib/format";
import type { ItemAttrs, WatchItem } from "@/lib/queries/items";

/** 건축물대장·토지특성·공시가격 요약. 수집 전이면 안내. */
export function AttrsCard({ item, attrs, marketPrice }: { item: WatchItem; attrs: ItemAttrs; marketPrice: number | null }) {
  const { building, parcel, prices } = attrs;
  const recap = (building?.recap ?? null) as Record<string, number | string | null> | null;
  const title0 = pickTitle((building?.titles ?? []) as Title[], item.dong_ho);
  const land = prices.filter((p) => p.target_type === "land");
  const unit = prices.filter((p) => p.target_type === "apt_unit" || p.target_type === "house");
  const lastUnit = unit.at(-1);
  const lastLand = land.at(-1);
  const prevLand = land.at(-2);
  // 공시가격(원) → 만원, 현실화율 = 공시가격 / 시세
  const realization = lastUnit && marketPrice ? lastUnit.price / 10000 / marketPrice : null;
  const isLand = item.property_type === "land" || item.property_type === "forest";
  const landArea = parcel?.area_m2 ?? item.land_area_m2;

  if (!building && !parcel && !prices.length) {
    return (
      <Card className="p-4 text-sm text-muted lg:col-span-3">
        건물 정보(건축물대장)·토지 정보·공시가격을 준비하고 있어요. 매일 아침 자동으로 수집되며, 준비되면 여기에 표시됩니다.
      </Card>
    );
  }
  return (
    <Card className="lg:col-span-3">
      <CardHeader title="건물·토지 정보" sub="건축물대장 · 토지특성 · 공시가격" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 pb-4 text-sm sm:grid-cols-4">
        {recap || title0 ? (
          <>
            <KV k={title0?.dong_nm ? `주용도 (${title0.dong_nm})` : "주용도"} v={String(title0?.main_purpose ?? "-")} />
            <KV k="사용승인" v={String(title0?.approved_at ?? "-")} />
            <KV k="세대수(단지)" v={formatNumber(Number(recap?.households) || sumHouseholds(building?.titles as Title[] | undefined))} />
            <KV k="용적률 / 건폐율" v={`${rate(recap?.vl_rat ?? title0?.vl_rat)} / ${rate(recap?.bc_rat ?? title0?.bc_rat)}`} />
            <KV k="주차" v={formatNumber(Number(recap?.parking ?? title0?.parking) || null)} />
            <KV k="층수" v={title0?.floors_above ? `지상 ${title0.floors_above} / 지하 ${title0.floors_below ?? 0}` : "-"} />
          </>
        ) : null}
        {parcel ? (
          <>
            <KV k="지목" v={parcel.jimok ?? "-"} />
            <KV k="토지 면적" v={landArea ? `${formatNumber(landArea)}㎡` : "-"} />
            <KV k="용도지역" v={parcel.land_use_zone?.join(", ") || "-"} />
            <KV k="도로 접면" v={parcel.road_side ?? "-"} />
            <KV k="지형" v={[parcel.terrain_height, parcel.terrain_shape].filter(Boolean).join(" · ") || "-"} />
          </>
        ) : null}
        {lastLand ? (
          <KV
            k={`개별공시지가(${lastLand.year})`}
            v={`${formatNumber(lastLand.price)}원/㎡`}
            sub={prevLand ? formatPct(lastLand.price / prevLand.price - 1) : undefined}
          />
        ) : null}
        {isLand && lastLand && landArea ? <KV k="공시지가 총액" v={formatManwon((lastLand.price * landArea) / 10000)} /> : null}
        {lastUnit ? (
          <KV k={`${lastUnit.target_type === "house" ? "개별주택" : "공동주택"} 공시가격(${lastUnit.year})`} v={formatManwon(lastUnit.price / 10000)} sub={realization ? `현실화율 ${formatPct(realization, 0, false)}` : undefined} />
        ) : null}
      </div>
      {parcel?.land_uses?.length ? (
        <div className="flex flex-wrap gap-1 px-4 pb-4">
          {parcel.land_uses.map((u) => (
            <Badge key={u.name} tone={/개발제한|토지거래|군사|보호|보전/.test(u.name) ? "warn" : "neutral"}>
              {u.name}
            </Badge>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

type Title = Record<string, number | string | null>;

/**
 * 표시할 동: 내 동(동·호 입력의 "5206동")과 같은 동 → 없으면 세대수가 가장 많은 동(주동).
 * 대장 목록 첫 줄은 상가·관리동인 경우가 많아 그대로 쓰면 "제1종근린생활시설 · 지상 1층"처럼 보인다.
 */
function pickTitle(titles: Title[], dongHo: string | null): Title | null {
  if (!titles.length) return null;
  const dong = dongHo?.match(/([0-9A-Za-z가-힣]+)\s*동/)?.[1];
  if (dong) {
    const mine = titles.find((t) => String(t.dong_nm ?? "").replace(/\s|동$/g, "") === dong);
    if (mine) return mine;
  }
  return [...titles].sort((a, b) => (Number(b.households) || 0) - (Number(a.households) || 0) || (Number(b.floors_above) || 0) - (Number(a.floors_above) || 0))[0];
}

/** 총괄표제부가 없는 단지(동별 표제부만 있음)는 동별 세대수를 더한다 */
function sumHouseholds(titles: Title[] | undefined): number | null {
  const n = (titles ?? []).reduce((a, t) => a + (Number(t.households) || 0), 0);
  return n || null;
}

/** 용적률·건폐율(대장 값은 198.83485 처럼 소수점이 길다). 0 은 대장에 값이 없는 것 */
function rate(v: number | string | null | undefined) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(1)}%` : "-";
}

function KV({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{k}</div>
      <div className="tabular truncate font-medium">
        {v}
        {sub ? <span className="ml-1 text-xs font-normal text-muted">{sub}</span> : null}
      </div>
    </div>
  );
}
