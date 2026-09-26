// 커스텀 지표 수식: 시계열 코드와 사칙연산·함수로 새 시계열을 만든다(eval 없이 직접 파싱).
//
// 문법:  expr   := term (('+' | '-') term)*
//        term   := unary (('*' | '/') unary)*
//        unary  := '-' unary | atom
//        atom   := number | series | func '(' expr (',' number)? ')' | '(' expr ')'
// 시계열: 영문·숫자·점·밑줄로 된 코드(예: idx.11710, ecos.base_rate). 함수 이름과 겹치면 함수로 해석.
// 함수:  ma(x, n) 이동평균, lag(x, n) n기간 전 값, yoy(x) 전년 동월 대비(%), mom(x) 전월 대비(%),
//        z(x) 전체 기간 z-score, rebase(x) 첫 값=100, log(x), abs(x)

export type Node =
  | { t: "num"; v: number }
  | { t: "ser"; code: string }
  | { t: "neg"; a: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; a: Node; b: Node }
  | { t: "fn"; name: Fn; a: Node; n?: number };

const FNS = ["ma", "lag", "yoy", "mom", "z", "rebase", "log", "abs"] as const;
type Fn = (typeof FNS)[number];
const NEEDS_N: Fn[] = ["ma", "lag"];

type Tok = { k: "num" | "id" | "op" | "(" | ")" | ","; v: string; pos: number };

export class ExprError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(src.slice(i))!;
      out.push({ k: "num", v: m[0], pos: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i))!;
      out.push({ k: "id", v: m[0].replace(/\.+$/, ""), pos: i });
      i += m[0].length;
    } else if ("+-*/".includes(c)) {
      out.push({ k: "op", v: c, pos: i++ });
    } else if (c === "(" || c === ")" || c === ",") {
      out.push({ k: c, v: c, pos: i++ });
    } else {
      throw new ExprError(`알 수 없는 문자 '${c}' (위치 ${i + 1})`);
    }
  }
  return out;
}

export function parse(src: string): Node {
  if (src.length > 500) throw new ExprError("수식이 너무 깁니다(500자 이하).");
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const expect = (k: Tok["k"], v?: string) => {
    const t = toks[p];
    if (!t || t.k !== k || (v && t.v !== v)) throw new ExprError(`'${v ?? k}' 가 필요합니다 (위치 ${t ? t.pos + 1 : src.length + 1})`);
    p++;
    return t;
  };
  function expr(): Node {
    let a = term();
    while (peek()?.k === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = toks[p++].v as "+" | "-";
      a = { t: "bin", op, a, b: term() };
    }
    return a;
  }
  function term(): Node {
    let a = unary();
    while (peek()?.k === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = toks[p++].v as "*" | "/";
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  }
  function unary(): Node {
    if (peek()?.k === "op" && peek().v === "-") {
      p++;
      return { t: "neg", a: unary() };
    }
    return atom();
  }
  function atom(): Node {
    const t = peek();
    if (!t) throw new ExprError("수식이 끝났습니다.");
    if (t.k === "num") {
      p++;
      return { t: "num", v: Number(t.v) };
    }
    if (t.k === "(") {
      p++;
      const e = expr();
      expect(")");
      return e;
    }
    if (t.k === "id") {
      p++;
      if ((FNS as readonly string[]).includes(t.v) && peek()?.k === "(") {
        p++;
        const a = expr();
        let n: number | undefined;
        if (peek()?.k === ",") {
          p++;
          n = Number(expect("num").v);
        }
        expect(")");
        const name = t.v as Fn;
        if (NEEDS_N.includes(name) && (!n || n < 1 || n > 120 || !Number.isInteger(n))) throw new ExprError(`${name}(x, n): n 은 1~120 정수`);
        return { t: "fn", name, a, n };
      }
      return { t: "ser", code: t.v };
    }
    throw new ExprError(`예상치 못한 '${t.v}' (위치 ${t.pos + 1})`);
  }
  const node = expr();
  if (p < toks.length) throw new ExprError(`예상치 못한 '${toks[p].v}' (위치 ${toks[p].pos + 1})`);
  return node;
}

export function seriesCodes(n: Node, acc = new Set<string>()): Set<string> {
  if (n.t === "ser") acc.add(n.code);
  else if (n.t === "neg" || n.t === "fn") seriesCodes(n.a, acc);
  else if (n.t === "bin") {
    seriesCodes(n.a, acc);
    seriesCodes(n.b, acc);
  }
  return acc;
}

/** 월 단위 정렬 시계열(키: YYYY-MM-01). 결측은 해당 기간 생략. */
export type Series = Map<string, number>;

function monthKey(d: string) {
  return `${d.slice(0, 7)}-01`;
}

function sortedKeys(s: Series) {
  return [...s.keys()].sort();
}

function shiftMonth(k: string, n: number) {
  const [y, m] = k.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function evaluate(n: Node, data: Record<string, [string, number][]>): Series {
  switch (n.t) {
    case "num":
      return new Map([["*", n.v]]); // 상수: 모든 기간에 브로드캐스트
    case "ser": {
      const pts = data[n.code];
      if (!pts) throw new ExprError(`시계열 '${n.code}' 를 찾을 수 없습니다.`);
      const m: Series = new Map();
      for (const [d, v] of pts) m.set(monthKey(d), v); // 주간 자료는 월 마지막 값
      return m;
    }
    case "neg": {
      const a = evaluate(n.a, data);
      return new Map([...a].map(([k, v]) => [k, -v]));
    }
    case "bin": {
      const a = evaluate(n.a, data);
      const b = evaluate(n.b, data);
      const keys = a.has("*") ? [...b.keys()] : b.has("*") ? [...a.keys()] : [...a.keys()].filter((k) => b.has(k));
      const out: Series = new Map();
      for (const k of keys) {
        const x = a.get(k) ?? a.get("*")!;
        const y = b.get(k) ?? b.get("*")!;
        const r = n.op === "+" ? x + y : n.op === "-" ? x - y : n.op === "*" ? x * y : y === 0 ? NaN : x / y;
        if (Number.isFinite(r)) out.set(k, r);
      }
      return out;
    }
    case "fn": {
      const a = evaluate(n.a, data);
      const keys = sortedKeys(a).filter((k) => k !== "*");
      const out: Series = new Map();
      if (n.name === "ma") {
        for (let i = n.n! - 1; i < keys.length; i++) {
          const w = keys.slice(i - n.n! + 1, i + 1).map((k) => a.get(k)!);
          out.set(keys[i], w.reduce((s, v) => s + v, 0) / w.length);
        }
      } else if (n.name === "lag" || n.name === "yoy" || n.name === "mom") {
        const lag = n.name === "lag" ? n.n! : n.name === "yoy" ? 12 : 1;
        for (const k of keys) {
          const prev = a.get(shiftMonth(k, lag));
          if (prev === undefined) continue;
          const cur = a.get(k)!;
          if (n.name === "lag") out.set(k, prev);
          else if (prev !== 0) out.set(k, (cur / prev - 1) * 100);
        }
      } else if (n.name === "z") {
        const vals = keys.map((k) => a.get(k)!);
        const mu = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
        const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mu) ** 2, 0) / (vals.length || 1));
        for (const k of keys) out.set(k, sd ? (a.get(k)! - mu) / sd : 0);
      } else if (n.name === "rebase") {
        const first = keys.length ? a.get(keys[0])! : 0;
        for (const k of keys) if (first) out.set(k, (a.get(k)! / first) * 100);
      } else {
        for (const k of keys) {
          const v = n.name === "log" ? Math.log(a.get(k)!) : Math.abs(a.get(k)!);
          if (Number.isFinite(v)) out.set(k, v);
        }
      }
      return out;
    }
  }
}

export function toPoints(s: Series): [string, number][] {
  return sortedKeys(s)
    .filter((k) => k !== "*")
    .map((k) => [k, s.get(k)!]);
}
