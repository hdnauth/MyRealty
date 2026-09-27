import { PROPERTY_TYPES } from "@/lib/property";
import type { CollectRun, CollectStepKey } from "@/lib/collect-steps";
import type { ItemDataStatus, WatchItem } from "@/lib/queries/items";
import { DataStatusLive, type StatusRow } from "./data-status-live";

/**
 * 등록 직후(또는 아직 비어 있는 데이터가 있을 때) 지금 볼 수 있는 것과 비어 있는 것을 알려 준다.
 * 개별 수집 실행기가 설정돼 있으면 빈 항목을 바로 불러오며 진행 상황을 보여 주고,
 * 없으면 매일 아침(06시 전후) 수집 때 채워진다고 안내한다.
 */
export function DataStatusCard({
  item,
  st,
  welcome,
  run,
  runnerReady,
}: {
  item: WatchItem;
  st: ItemDataStatus;
  welcome: boolean;
  run: CollectRun | null;
  runnerReady: boolean;
}) {
  const rows = statusRows(item, st);
  const corePending = rows.some((r) => !r.ok && r.core);
  const active = run?.status === "queued" || run?.status === "running";
  // 등록 직후가 아니면 핵심(실거래·추정 시세)이 비어 있거나 수집 중일 때만 보인다
  if (!welcome && !corePending && !active) return null;
  // 핵심이 비어 있고 최근에 요청한 적이 없으면 화면을 열 때 바로 요청한다(서버가 한 번 더 확인)
  const autoStart = runnerReady && corePending && !active && !run?.recent;
  return <DataStatusLive itemId={item.id} rows={rows} welcome={welcome} initialRun={run} runnerReady={runnerReady} autoStart={autoStart} />;
}

function statusRows(item: WatchItem, st: ItemDataStatus): StatusRow[] {
  const isLand = item.property_type === "land" || item.property_type === "forest";
  const hasComplex = PROPERTY_TYPES[item.property_type].hasComplex;
  const hasUnit = Boolean(item.dong_ho);
  const row = (r: Omit<StatusRow, "core"> & { core?: boolean }): StatusRow => ({ core: false, ...r });
  return [
    hasComplex
      ? row({
          ok: st.trades > 0,
          core: true,
          step: "trades",
          label: "실거래",
          ready: `${st.trades.toLocaleString()}건 연결됨`,
          later: "다음 수집 때 이 단지 거래를 연결합니다",
          empty: "이 단지와 연결된 거래가 없습니다(신축·거래 없음, 또는 단지명이 달라 연결되지 않음). 주변 유사 단지로 비교합니다",
          href: "?tab=price",
        })
      : row({
          ok: st.areaTrades > 0,
          core: true,
          step: "trades",
          label: "주변 유사 거래",
          ready: `같은 동네 최근 1년 ${st.areaTrades.toLocaleString()}건으로 비교합니다`,
          later: "같은 동네·유사 면적 거래를 다음 수집 때 모읍니다",
          empty: "같은 동네에 최근 1년 신고된 같은 유형 거래가 없습니다",
          href: "?tab=price",
        }),
    row({
      ok: st.building || st.parcel,
      step: "attrs",
      label: isLand ? "토지 정보" : "건물 정보",
      ready: isLand ? "지목·용도지역·도로 접면" : "준공·용도·세대수",
      later: "건축물대장·토지특성을 다음 수집 때 받습니다",
      empty: "공공데이터에 이 필지의 대장·토지특성이 없습니다",
    }),
    row({
      ok: st.officialPrice,
      step: "attrs",
      label: isLand ? "개별공시지가" : "공시가격",
      ready: "연도별 이력",
      later: "공시가격을 다음 수집 때 받습니다",
      empty: hasComplex && !hasUnit ? "동·호를 입력하면 호별 공동주택가격을 찾습니다(수정에서 입력)" : "공시가격 자료가 없습니다",
    }),
    row({
      ok: st.location,
      step: "location",
      label: "입지 점수",
      ready: "교통·학교·생활편의",
      later: "주변 시설을 모아 점수를 계산합니다",
      empty: "좌표나 주변 시설 자료가 부족해 계산하지 못했습니다",
      href: "?tab=location",
    }),
    row({
      ok: st.valuation,
      core: true,
      step: "valuation",
      label: "추정 시세",
      ready: "구간·신뢰도",
      later: "거래가 모이면 계산합니다",
      empty: "비교할 거래가 부족해 계산하지 못했습니다",
    }),
    row({
      ok: st.news > 0,
      step: "news",
      label: "관련 뉴스",
      ready: `${st.news}건`,
      later: "키워드로 매일 모읍니다",
      empty: "최근 관련 뉴스가 없습니다(매일 다시 찾습니다)",
      href: "?tab=news",
    }),
  ] satisfies (StatusRow & { step: CollectStepKey })[];
}
