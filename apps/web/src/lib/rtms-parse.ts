// 국토교통부 실거래가 API 응답 해석(서버·테스트 공용 순수 함수). ETL 의 collectors/rtms.py 와 같은 서비스·필드

export type RtmsSvc = { path: string; kind: "sale" | "rent"; name: string[]; area: string[] };
const AREA = ["excluUseAr", "totalFloorAr", "buildingAr", "dealArea"];
export const RTMS_SERVICES: Record<string, RtmsSvc[]> = {
  apt: [
    { path: "RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev", kind: "sale", name: ["aptNm"], area: AREA },
    { path: "RTMSDataSvcAptRent/getRTMSDataSvcAptRent", kind: "rent", name: ["aptNm"], area: AREA },
  ],
  officetel: [
    { path: "RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade", kind: "sale", name: ["offiNm"], area: AREA },
    { path: "RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent", kind: "rent", name: ["offiNm"], area: AREA },
  ],
  rowhouse: [
    { path: "RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade", kind: "sale", name: ["mhouseNm"], area: AREA },
    { path: "RTMSDataSvcRHRent/getRTMSDataSvcRHRent", kind: "rent", name: ["mhouseNm"], area: AREA },
  ],
  house: [{ path: "RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade", kind: "sale", name: [], area: AREA }],
  land: [{ path: "RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade", kind: "sale", name: [], area: AREA }],
  commercial: [{ path: "RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade", kind: "sale", name: ["buildingUse"], area: AREA }],
};

export type LiveTrade = {
  kind: "sale" | "jeonse" | "wolse";
  date: string;
  price: number;
  rent: number | null;
  area: number | null;
  floor: number | null;
  umd: string;
  jibun: string;
  name: string;
  jimok: string | null;
  buildYear: number | null;
  canceled: boolean;
};

/** 응답 XML → item 태그 목록(간단한 평면 구조라 정규식으로 충분) */
export function parseRtmsXml(text: string): { items: Record<string, string>[]; total: number } {
  const code = text.match(/<resultCode>([^<]*)<\/resultCode>/)?.[1] ?? text.match(/<returnReasonCode>([^<]*)</)?.[1];
  if (code && code !== "00" && code !== "000") {
    const msg = text.match(/<resultMsg>([^<]*)</)?.[1] ?? text.match(/<returnAuthMsg>([^<]*)</)?.[1] ?? "";
    throw new Error(`실거래 API 오류 ${code}: ${msg}`);
  }
  const items: Record<string, string>[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it: Record<string, string> = {};
    for (const f of m[1].matchAll(/<(\w+)>([^<]*)<\/\1>/g)) it[f[1]] = f[2].trim();
    items.push(it);
  }
  return { items, total: Number(text.match(/<totalCount>(\d+)</)?.[1] ?? items.length) };
}

const int = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/,/g, ""));
  return v && v.trim() !== "" && Number.isFinite(n) ? n : null;
};
const pick = (it: Record<string, string>, keys: string[]) => keys.map((k) => it[k]).find((v) => v) ?? "";

export function normalizeLive(it: Record<string, string>, svc: RtmsSvc): LiveTrade | null {
  const y = int(it.dealYear);
  const mo = int(it.dealMonth);
  const d = int(it.dealDay);
  if (!y || !mo || !d) return null;
  const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let price: number | null;
  let rent: number | null = null;
  let kind: LiveTrade["kind"] = "sale";
  if (svc.kind === "sale") price = int(it.dealAmount);
  else {
    price = int(it.deposit);
    rent = int(it.monthlyRent) ?? 0;
    kind = rent > 0 ? "wolse" : "jeonse";
  }
  if (price === null) return null;
  return {
    kind,
    date,
    price,
    rent,
    area: int(pick(it, svc.area)),
    floor: int(it.floor),
    umd: it.umdNm ?? "",
    jibun: it.jibun ?? "",
    name: pick(it, svc.name),
    jimok: it.jimok || null,
    buildYear: int(it.buildYear),
    canceled: it.cdealType === "O",
  };
}

export function recentMonths(n: number, from = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(from.getFullYear(), from.getMonth() - i, 1);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

