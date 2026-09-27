import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { after } from "next/server";
import type { CollectRun } from "./collect-steps";
import { sql } from "./db";
import { env } from "./env";

/*
 * 관심 부동산 개별 수집: 등록 직후(또는 빈 데이터가 있는 부동산을 열 때) 그 부동산만 바로 수집한다.
 * 웹은 item_collect_runs 에 실행 기록(queued)을 만들고 실행기를 깨운다. 실제 수집은 ETL(`myrealty item`)이
 * 단계별로 기록을 채우며, 화면은 그 기록을 주기적으로 읽어 진행 상황을 보여 주고 끝난 단계부터 새로 그린다.
 *
 * 실행기: GitHub Actions(etl-item.yml, GITHUB_DISPATCH_TOKEN·GITHUB_DISPATCH_REPO) → 로컬 개발(ITEM_COLLECT_LOCAL=1)
 */

export type CollectRunner = "github" | "local";

export function collectRunner(): CollectRunner | null {
  if (env.githubDispatchToken && env.githubDispatchRepo) return "github";
  if (env.itemCollectLocal) return "local";
  return null;
}

/** 대기가 이만큼 길면(실행기가 못 받음) 또는 실행이 이만큼 길면(중간에 죽음) 끝난 것으로 본다 */
const QUEUE_TIMEOUT = "10 minutes";
const RUN_TIMEOUT = "40 minutes";
/** 자동 요청(화면을 열 때)은 마지막 요청 뒤 이만큼 지나야 다시 한다 */
const AUTO_COOLDOWN_H = 12;

const RUN_COLUMNS = sql`id::int as id, status, runner, steps, error, requested_at::text, started_at::text, finished_at::text,
  (requested_at > now() - ${`${AUTO_COOLDOWN_H} hours`}::interval) as recent`;

export async function latestRun(itemId: string): Promise<CollectRun | null> {
  // 멈춘 실행은 여기서 닫는다(별도 정리 작업 없이)
  await sql`
    update item_collect_runs set status = 'error', finished_at = now(),
      error = case status when 'queued' then '실행기가 요청을 받지 못했습니다(대기 시간 초과)' else '수집이 중간에 멈췄습니다(시간 초과)' end
    where watch_item_id = ${itemId} and (
      (status = 'queued' and requested_at < now() - ${QUEUE_TIMEOUT}::interval)
      or (status = 'running' and coalesce(started_at, requested_at) < now() - ${RUN_TIMEOUT}::interval))`;
  const [run] = await sql<CollectRun[]>`
    select ${RUN_COLUMNS} from item_collect_runs where watch_item_id = ${itemId} order by requested_at desc limit 1`;
  return run ?? null;
}

async function dispatchGithub(itemId: string, runId: number) {
  const res = await fetch(`https://api.github.com/repos/${env.githubDispatchRepo}/actions/workflows/etl-item.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.githubDispatchToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "MyRealty",
    },
    body: JSON.stringify({ ref: env.githubDispatchRef, inputs: { item_id: itemId, run_id: String(runId) } }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 200);
    const hint =
      res.status === 401 ? "토큰이 틀렸거나 만료됐습니다" : res.status === 403 ? "토큰에 Actions 쓰기 권한이 없습니다" : res.status === 404 ? "리포지토리·워크플로(etl-item.yml)·브랜치를 찾을 수 없습니다" : "";
    throw new Error(`GitHub ${res.status}${hint ? ` — ${hint}` : ""}${text ? `: ${text}` : ""}`);
  }
}

function spawnLocal(itemId: string, runId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cwd = path.resolve(process.cwd(), "../../services/etl");
    const child = spawn("uv", ["run", "myrealty", "item", "--item", itemId, "--run", String(runId)], { cwd, detached: true, stdio: "ignore" });
    child.once("error", (e) => reject(new Error(`로컬 ETL 실행 실패(${cwd}): ${e.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export type CollectRequest = { run: CollectRun | null; runner: CollectRunner | null; started: boolean };

/**
 * 개별 수집 요청. 이미 진행 중이면 그 실행을, auto 이고 최근에 한 번 했으면 마지막 실행을 돌려준다.
 * 실행기 호출은 응답 뒤(after)에 해서 등록·화면 응답을 늦추지 않는다. 호출이 실패하면 실행 기록에 사유를 남긴다.
 */
export async function requestCollect(itemId: string, mode: "register" | "auto" | "manual"): Promise<CollectRequest> {
  const runner = collectRunner();
  if (!runner) return { run: null, runner, started: false };
  const last = await latestRun(itemId);
  if (last && (last.status === "queued" || last.status === "running")) return { run: last, runner, started: false };
  if (mode === "auto" && last?.recent) {
    return { run: last, runner, started: false };
  }
  const [run] = await sql<CollectRun[]>`
    insert into item_collect_runs (watch_item_id, runner) values (${itemId}, ${runner}) returning ${RUN_COLUMNS}`;
  after(async () => {
    try {
      if (runner === "github") await dispatchGithub(itemId, run.id);
      else await spawnLocal(itemId, run.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[collect]", msg);
      await sql`update item_collect_runs set status = 'error', error = ${msg.slice(0, 500)}, finished_at = now()
                where id = ${run.id} and status = 'queued'`;
    }
  });
  return { run, runner, started: true };
}
