// 단지가 없는 유형의 읍면동 시장(서버·브라우저 공용 타입·이름). 조회는 queries/region-market.ts
/**
 * 단지가 없는 유형(단독·다가구, 토지·임야, 상가·업무)의 읍면동 시장.
 * 실거래 신고 자료는 지번 일부가 가려져 있고 건물명이 없어 단지처럼 묶을 수 없다 — 지도도 읍면동 단위로 집계한다.
 * 그 읍면동 안 거래를 세부 유형(주택 유형·지목·건물 용도)별로 나눠 보여 준다.
 */
export const REGION_TYPES = ["house", "land", "commercial"] as const;
export type RegionType = (typeof REGION_TYPES)[number];

export function isRegionType(v: unknown): v is RegionType {
  return REGION_TYPES.includes(v as RegionType);
}

/** 화면 이름 · 세부 유형 이름 · 단위가격 기준 면적(지도 집계와 같은 coalesce(area_m2, land_area_m2)) */
export const REGION_TYPE_INFO: Record<RegionType, { label: string; category: string; area: string }> = {
  house: { label: "단독·다가구", category: "주택 유형", area: "연면적" },
  land: { label: "토지", category: "지목", area: "토지면적" },
  commercial: { label: "상가·업무", category: "건물 용도", area: "건물면적" },
};

export type RegionTrade = {
  id: number;
  deal_kind: "sale" | "jeonse" | "wolse";
  deal_date: string;
  price: number;
  monthly_rent: number | null;
  /** 단위가격 기준 면적(토지면적·연면적·건물면적) */
  area_m2: number | null;
  /** 대지면적(단독·상가) */
  land_area_m2: number | null;
  floor: number | null;
  build_year: number | null;
  /** 일부 가려진 지번(1** 등) */
  jibun: string | null;
  category: string | null;
  /** 용도지역(토지·상가) */
  land_use: string | null;
  is_canceled: boolean;
  is_direct: boolean | null;
};

export type RegionGroup = { category: string; n: number; n12m: number; perM2: number | null; price: number | null; area: number | null };

export type RegionMarket = {
  region: { lawd_cd: string; sgg_cd: string; emd: string; sgg_name: string | null; lng: number | null; lat: number | null };
  type: RegionType;
  trades: RegionTrade[];
  /** 매매 · 세부 유형별(기간 전체) */
  groups: RegionGroup[];
  /** 매매 · 용도지역별(토지·상가) */
  zones: { zone: string; n: number; perM2: number | null }[];
  /** 유형별 거래 수(이 읍면동, 최근 1년) — 유형 전환 탭 */
  typeCounts: Record<RegionType, number>;
  stats: {
    sale12m: number;
    jeonse12m: number;
    wolse12m: number;
    salePrice12m: number | null;
    perM2_12m: number | null;
    /** 최근 6개월 vs 12~18개월 전 매매 ㎡당 중위(각 6건 이상 — 필지·건물이 제각각이라 적으면 잡음) */
    change1y: number | null;
  };
  /** 유형별 '눈여겨볼 점'을 만드는 원자료(매매는 받은 기간 전체, 임대·거래량은 최근 1년) */
  signals: RegionSignals;
};

export type RegionSignals = {
  saleN: number;
  /** 지분 거래(토지·상가) */
  shareN: number;
  sharePerM2: number | null;
  noSharePerM2: number | null;
  directN: number;
  /** 법인 매수 · 매수자 구분이 있는 매매 */
  corpN: number;
  corpKnown: number;
  /** 매매 건수: 최근 1년 · 그 전 1년 */
  vol12: number;
  volPrev: number;
  /** 토지: 도로·구거 · 농지(전·답·과수원) 매매 */
  roadN: number;
  farmN: number;
  /** 단독: 대지 ㎡당 매매 중위(최근 1년) */
  landPerM2_12: number | null;
  /** 준공 연도가 있는 거래 · 그중 30년 넘은 것 */
  agedKnown: number;
  agedN: number;
  /** 임대(최근 1년, ㎡당 중위): 전세 보증금 · 월세 보증금 · 월세 */
  jeonsePerM2: number | null;
  wolseDepPerM2: number | null;
  rentPerM2: number | null;
  /** 상가: 집합 1층 · 2층 이상 ㎡당 중위 */
  groundPerM2: number | null;
  groundN: number;
  upperPerM2: number | null;
  upperN: number;
};

export type RegionInsight = { tone: "warn" | "info" | "good"; title: string; text: string };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(1)}배`;

/**
 * 유형별 '눈여겨볼 점': 실거래에서 바로 계산되는 것만, 표본이 충분할 때만 말한다.
 * 토지는 지분거래(기획부동산 신호)·도로 지목·농지, 단독은 대지 평당가·노후도·월세 전환율, 상가는 1층 프리미엄·법인 매수.
 */
export function regionInsights(m: Pick<RegionMarket, "type" | "signals">, unit: "m2" | "pyeong"): RegionInsight[] {
  const s = m.signals;
  const out: RegionInsight[] = [];
  const perUnit = (perM2: number) => (unit === "pyeong" ? perM2 * 3.305785 : perM2);
  const money = (v: number) => (v >= 10_000 ? `${(v / 10_000).toFixed(1)}억` : `${Math.round(v).toLocaleString()}만`);
  const ul = unit === "pyeong" ? "평당" : "㎡당";

  if ((m.type === "land" || m.type === "commercial") && s.saleN >= 5 && s.shareN > 0) {
    const r = s.shareN / s.saleN;
    const gap = s.sharePerM2 && s.noSharePerM2 ? s.sharePerM2 / s.noSharePerM2 : null;
    if (r >= 0.3 || (gap !== null && gap >= 1.5 && s.shareN >= 3)) {
      out.push({
        tone: "warn",
        title: `지분거래 ${pct(r)}${gap !== null && gap >= 1.2 ? ` · ㎡당 일반 거래의 ${times(gap)}` : ""}`,
        text: "한 필지를 여럿이 나눠 사는 지분 거래는 기획부동산이 임야·농지를 쪼개 파는 전형적인 방식입니다. 혼자 쓰거나 개발하기 어렵고 되팔기도 어렵습니다. 시세는 '지분거래 빼고 보기'로 확인하세요.",
      });
    } else if (r >= 0.1) {
      out.push({ tone: "info", title: `지분거래 ${pct(r)}`, text: "지분 거래가 섞여 있어 동네 중위가 실제 단독 필지 시세와 다를 수 있어요." });
    }
  }
  if (m.type === "land" && s.saleN >= 10) {
    if (s.roadN / s.saleN >= 0.15)
      out.push({ tone: "info", title: `도로 지목 거래 ${pct(s.roadN / s.saleN)}`, text: "도로·구거는 ㎡당 가격이 아주 낮아 동네 전체 중위를 끌어내립니다. 지목별 시세로 비교하세요." });
    if (s.farmN / s.saleN >= 0.3)
      out.push({ tone: "info", title: `농지 거래 ${pct(s.farmN / s.saleN)}`, text: "전·답·과수원은 살 때 농지취득자격증명이 필요하고, 직접 농사짓지 않으면 처분 의무가 생길 수 있어요." });
  }
  if (m.type === "house") {
    if (s.landPerM2_12)
      out.push({ tone: "info", title: `대지 ${ul} ${money(perUnit(s.landPerM2_12))}`, text: "단독·다가구는 건물보다 땅값으로 거래됩니다. 비슷한 대지면적끼리 대지 단가로 비교하세요(최근 1년 매매 중위)." });
    if (s.agedKnown >= 10 && s.agedN / s.agedKnown >= 0.5)
      out.push({ tone: "info", title: `30년 넘은 주택 ${pct(s.agedN / s.agedKnown)}`, text: "노후 주택 비율이 높은 동네입니다. 정비사업 논의가 있거나 앞으로 생길 수 있어 개발·테마의 정비구역을 함께 확인하세요." });
    if (s.jeonsePerM2 && s.wolseDepPerM2 !== null && s.rentPerM2 && s.jeonsePerM2 > s.wolseDepPerM2) {
      const conv = (s.rentPerM2 * 12) / (s.jeonsePerM2 - s.wolseDepPerM2);
      if (conv > 0.01 && conv < 0.2)
        out.push({ tone: "info", title: `전월세 전환율 약 ${(conv * 100).toFixed(1)}%`, text: `보증금 1억을 월세로 돌리면 월 ${Math.round((10_000 * conv) / 12)}만원 수준입니다(최근 1년 ㎡당 중위로 낸 추정).` });
    }
  }
  if (m.type === "commercial") {
    if (s.groundPerM2 && s.upperPerM2 && s.groundN >= 3 && s.upperN >= 3)
      out.push({ tone: "info", title: `1층 ${ul}이 상층의 ${times(s.groundPerM2 / s.upperPerM2)}`, text: "같은 구분 상가라도 층에 따라 가격이 크게 다릅니다. '층' 조건으로 같은 층끼리 비교하세요." });
    out.push({ tone: "info", title: "임대료는 공개되지 않아요", text: "상가 임대 실거래는 공개되지 않아 수익률은 매물의 임대차 계약서·공실 여부로 직접 확인해야 합니다." });
  }
  if (s.corpKnown >= 5 && s.corpN / s.corpKnown >= 0.25)
    out.push({ tone: "info", title: `법인 매수 ${pct(s.corpN / s.corpKnown)}`, text: "법인 매수가 많은 곳은 개인 실수요보다 투자·사업 목적 거래가 시세를 이끌 수 있어요." });
  if (s.saleN >= 10 && s.directN / s.saleN >= 0.4)
    out.push({ tone: "warn", title: `직거래 ${pct(s.directN / s.saleN)}`, text: "직거래는 가족·지인 간 거래가 섞여 시세보다 낮거나 높게 신고될 수 있어요. 중개 거래 위주로 시세를 보세요." });
  if (s.volPrev >= 5) {
    const c = s.vol12 / s.volPrev - 1;
    if (Math.abs(c) >= 0.3)
      out.push({ tone: c > 0 ? "good" : "warn", title: `매매 거래량 1년 새 ${c > 0 ? "+" : ""}${pct(c)}`, text: c > 0 ? "거래가 늘고 있어요. 가격보다 거래량이 먼저 움직이는 경우가 많습니다." : "거래가 줄고 있어요. 팔 때 시간이 더 걸릴 수 있습니다." });
  }
  return out;
}
