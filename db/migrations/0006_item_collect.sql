-- 관심 부동산 개별 수집(등록 직후·빈 데이터가 있을 때 그 부동산만 바로 수집)
-- 웹이 행을 만들고(queued) GitHub Actions(etl-item.yml) 또는 로컬 프로세스가 `myrealty item` 으로 단계별 진행을 채운다.

create table item_collect_runs (
  id             bigserial primary key,
  watch_item_id  uuid not null references watch_items on delete cascade,
  status         text not null default 'queued',   -- queued | running | done | error
  runner         text,                             -- github | local | cli
  steps          jsonb not null default '{}',      -- {trades: {status, detail, started_at, finished_at}, ...}
  error          text,
  requested_at   timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
create index item_collect_runs_item_idx on item_collect_runs (watch_item_id, requested_at desc);

-- 토지·임야 기본 탐색 반경 확대(거래가 드물어 2km 로는 비교 거래가 거의 없다). 기본값(2km) 그대로인 것만
update watch_items set radius_m = 5000 where property_type = 'land' and radius_m = 2000;
update watch_items set radius_m = 10000 where property_type = 'forest' and radius_m = 2000;
