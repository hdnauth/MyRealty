// 주택 보유세 개략 추정(참고용). 단위: 만원. 공시가격 입력은 만원.
// 반영: 재산세(표준/1세대1주택 특례세율·공정시장가액비율), 도시지역분, 지방교육세, 종부세(2주택 이하 세율), 농특세.
// 미반영: 종부세 세액공제(고령자·장기보유), 재산세 중복분 공제, 세부담 상한, 3주택 이상 중과, 토지분.

type Bracket = [limit: number, rate: number];

function progressive(base: number, brackets: Bracket[]) {
  let tax = 0;
  let prev = 0;
  for (const [limit, rate] of brackets) {
    if (base <= prev) break;
    tax += (Math.min(base, limit) - prev) * rate;
    prev = limit;
  }
  return tax;
}

const INF = Number.POSITIVE_INFINITY;
const PROPERTY_STD: Bracket[] = [[6000, 0.001], [15000, 0.0015], [30000, 0.0025], [INF, 0.004]];
const PROPERTY_ONE: Bracket[] = [[6000, 0.0005], [15000, 0.001], [30000, 0.002], [INF, 0.0035]];
const COMPREHENSIVE: Bracket[] = [[30000, 0.005], [60000, 0.007], [120000, 0.01], [250000, 0.013], [500000, 0.015], [940000, 0.02], [INF, 0.027]];

/** 1세대1주택 공정시장가액비율 특례(공시가 3억 이하 43%, 6억 이하 44%, 초과 45%), 그 외 60% */
export function fairMarketRatio(official: number, oneHouse: boolean) {
  if (!oneHouse) return 0.6;
  return official <= 30000 ? 0.43 : official <= 60000 ? 0.44 : 0.45;
}

export function propertyTax(official: number, oneHouse: boolean) {
  const base = official * fairMarketRatio(official, oneHouse);
  const special = oneHouse && official <= 90000; // 특례세율: 1세대1주택 공시가 9억 이하
  const main = progressive(base, special ? PROPERTY_ONE : PROPERTY_STD);
  const urban = base * 0.0014; // 도시지역분
  const edu = main * 0.2; // 지방교육세
  return { base, main, urban, edu, total: main + urban + edu };
}

export function comprehensiveTax(totalOfficial: number, oneHouse: boolean) {
  const deduction = oneHouse ? 120000 : 90000;
  const base = Math.max(0, (totalOfficial - deduction) * 0.6);
  const main = progressive(base, COMPREHENSIVE);
  return { base, main, rural: main * 0.2, total: main * 1.2 };
}

export function holdingTax(officials: number[], oneHouse: boolean) {
  const perHouse = officials.map((o) => propertyTax(o, oneHouse));
  const comp = comprehensiveTax(officials.reduce((a, b) => a + b, 0), oneHouse);
  const property = perHouse.reduce((a, t) => a + t.total, 0);
  return { perHouse, property, comprehensive: comp, total: property + comp.total };
}
