/**
 * 멈추지 않는 DB 클라이언트 래퍼(postgres.js).
 *
 * 운영(Vercel 서버리스 + Supabase 풀러)에서 쿼리가 응답 없이 함수 시간 제한까지 멈추는 일이 있었다. DB 쪽에서는 백엔드가
 * '쿼리 도중 클라이언트 대기(active · ClientRead)'로 남았고, 같은 인스턴스의 연결(최대 5개)이 이렇게 묶이면 다음 요청들도
 * 그 뒤에 줄을 서서 함께 멈췄다. 원인은 두 가지가 겹친다:
 * - 함수가 잠든 사이 풀러·NAT 가 끊은 소켓을 깨어난 뒤 그대로 재사용(Supabase 문서의 서버리스 postgres-js 멈춤)
 * - 파라미터 쿼리의 첫 실행 때 postgres.js 가 보내는 Parse/Describe/Flush 응답이 풀러에서 넘어오지 않는 경우
 * 드라이버를 바꾸지 않고, (1) 오래 쉰 연결 묶음은 다음 쿼리 전에 새로 만들고 (2) 실행한 쿼리가 stallMs 안에 끝나지 않으면
 * 연결 묶음을 새로 만들고 옛 연결을 강제로 닫아 멈춘 쿼리를 오류로 끝낸다(무한 대기 → 오류 한 번, 다음 요청은 정상).
 *
 * 쿼리 조각(sql`...`을 다른 쿼리에 끼워 넣는 것)은 실행되지 않아야 하므로, 실제로 then(await)될 때만 추적한다.
 */

type Client = ((...args: unknown[]) => unknown) & { end: (o?: { timeout?: number }) => Promise<void> } & Record<string | symbol, unknown>;

export type ResilientOptions = {
  /** 실행한 쿼리가 이보다 오래 끝나지 않으면 연결 묶음을 새로 만든다 */
  stallMs: number;
  /** 이보다 오래 쓰지 않은 연결 묶음은 다음 쿼리 전에 새로 만든다(0 이면 끔 — 서버리스에서만 켠다) */
  idleRecycleMs: number;
  now?: () => number;
  onRecycle?: (reason: "stall" | "idle") => void;
};

/** postgres.js 쿼리(Promise 를 상속, 실행 전까지 게으름)인지 — sql(...) 도우미·sql.json 값 등은 그대로 둔다 */
function isQuery(x: unknown): x is Promise<unknown> & { then: Promise<unknown>["then"] } {
  return x instanceof Promise && typeof (x as unknown as { cancel?: unknown }).cancel === "function";
}

export function createResilientClient<T extends object>(make: () => T, opts: ResilientOptions): { client: T; recycle: (reason: "stall" | "idle") => void } {
  const now = opts.now ?? Date.now;
  let current = make() as unknown as Client;
  let lastUse = now();

  const recycle = (reason: "stall" | "idle", from: Client = current) => {
    if (from !== current) return; // 이미 바꿨다
    current = make() as unknown as Client;
    opts.onRecycle?.(reason);
    // 옛 연결은 바로 닫는다 — 멈춘 쿼리는 오류로 끝나고 소켓이 풀린다
    void from.end({ timeout: 0 }).catch(() => {});
  };

  const active = (): Client => {
    const t = now();
    if (opts.idleRecycleMs > 0 && t - lastUse > opts.idleRecycleMs) recycle("idle");
    lastUse = t;
    return current;
  };

  const track = (q: Promise<unknown>, owner: Client) => {
    const orig = q.then;
    let started = false;
    let done = false;
    const finish = () => {
      done = true;
      lastUse = now();
    };
    // await 할 때(then) 실행이 시작된다 — 그때부터 감시
    q.then = function (this: Promise<unknown>, onOk?: ((v: unknown) => unknown) | null, onErr?: ((e: unknown) => unknown) | null) {
      if (!started) {
        started = true;
        const timer = setTimeout(() => {
          if (!done) recycle("stall", owner);
        }, opts.stallMs);
        (timer as { unref?: () => void }).unref?.();
      }
      return orig.call(
        this,
        (v: unknown) => {
          finish();
          return onOk ? onOk(v) : v;
        },
        (e: unknown) => {
          finish();
          if (onErr) return onErr(e);
          throw e;
        },
      );
    } as Promise<unknown>["then"];
    return q;
  };

  const target = function () {} as unknown as Client;
  const client = new Proxy(target, {
    apply(_t, _this, args) {
      const c = active();
      const out = c(...args);
      return isQuery(out) ? track(out, c) : out;
    },
    get(_t, prop) {
      const c = prop === "end" ? current : active();
      const v = c[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
    },
  }) as unknown as T;
  return { client, recycle: (reason) => recycle(reason) };
}
