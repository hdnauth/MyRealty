"""myrealty CLI — ETL 잡 엔트리포인트.

예) uv run myrealty migrate
    uv run myrealty daily          # 매일 아침 전체 파이프라인
    uv run myrealty rtms --months 3
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Callable

from .db import connect, job_run

COMMANDS: dict[str, tuple[str, Callable[[argparse.Namespace], dict | list | None], Callable[[argparse.ArgumentParser], None] | None]] = {}


def command(name: str, help: str, args: Callable[[argparse.ArgumentParser], None] | None = None):
    def deco(fn):
        COMMANDS[name] = (help, fn, args)
        return fn
    return deco


def _with_job(name: str, fn: Callable) -> dict:
    with connect() as conn, job_run(conn, name) as detail:
        detail.update(fn(conn) or {})
        return detail


@command("migrate", "DB 마이그레이션 적용")
def _migrate(ns):
    from .migrate import migrate
    return {"applied": migrate()}


@command("rtms", "실거래 최근 N개월 재수집", lambda p: p.add_argument("--months", type=int, default=3))
def _rtms(ns):
    from .jobs.rtms_job import collect_recent
    return _with_job("rtms", lambda c: collect_recent(c, ns.months))


@command("backfill", "실거래 과거 백필", lambda p: p.add_argument("--max-months", type=int, default=6))
def _backfill(ns):
    from .jobs.rtms_job import backfill
    return _with_job("backfill", lambda c: backfill(c, ns.max_months))


@command("geocode", "좌표 없는 단지/읍면동 지오코딩")
def _geocode(ns):
    from .transforms.geocode import geocode_pending
    return _with_job("geocode", geocode_pending)


def _demo_args(p):
    p.add_argument("--email", help="데모 부동산을 등록할 사용자 이메일(허용 목록에도 추가)")
    p.add_argument("--reset", action="store_true", help="데모 데이터만 삭제")


@command("link", "관심 부동산 ↔ 단지 연결")
def _link(ns):
    from .transforms.complexes import link_watch_items
    return _with_job("link", link_watch_items)


def _simple(name: str, target: str, help_: str, args=None):
    """단일 단계 CLI 명령 등록."""

    def run(ns):
        import importlib

        mod, fn = target.split(":")
        func = getattr(importlib.import_module(mod), fn)
        kwargs = {k: v for k, v in vars(ns).items() if k not in ("cmd",) and v is not None}
        return _with_job(name, lambda c: func(c, **kwargs))

    COMMANDS[name] = (help_, run, args)


_simple("attrs", "myrealty_etl.jobs.attrs_job:refresh_attrs", "건축물대장·토지·공시가격 수집")
_simple("events", "myrealty_etl.jobs.events_job:collect_events", "청약·연례 일정 이벤트 수집")
_simple("news", "myrealty_etl.jobs.news_job:collect_news", "관심 부동산 뉴스 수집")
_simple("zones", "myrealty_etl.jobs.zones_job:collect_zones",
        "정비구역 수집(서울 정보몽땅·경계, 경기·부산·인천·시군구 파일, 국토부 전국) + 단지 연결·단계 효과",
        lambda p: p.add_argument("--only", nargs="*", help="seoul seoul_boundaries gyeonggi busan incheon files molit link effects"))
_simple("regulations", "myrealty_etl.collectors.regulations:collect_regulations", "토지거래허가구역·지구단위계획구역 경계(브이월드)")
_simple("rail-seed", "myrealty_etl.collectors.rail_seed:collect_rail_seed", "교통 호재 시드(계획·최근 개통 철도 노선·역)",
        lambda p: p.add_argument("--force", action="store_true", default=None))
_simple("rebuild-attrs", "myrealty_etl.jobs.rebuild_job:collect_rebuild_attrs", "재건축 후보(준공 27년+) 단지 건축물대장·용도지역",
        lambda p: p.add_argument("--limit", type=int))
_simple("classify", "myrealty_etl.ai.news_classifier:classify_pending", "뉴스 AI 분류(배치/동기)",
        lambda p: p.add_argument("--mode", choices=["auto", "sync", "batch"]))
_simple("macro", "myrealty_etl.collectors.macro:collect_macro", "ECOS·KOSIS·R-ONE 지표 수집")
def _item_args(p):
    p.add_argument("--item", required=True, help="관심 부동산 id(uuid)")
    p.add_argument("--run", type=int, help="웹이 만든 item_collect_runs.id(없으면 새로 만든다)")


@command("item", "관심 부동산 하나만 바로 수집(등록 직후 개별 수집)", _item_args)
def _item(ns):
    from .http import explain_error
    from .jobs.item_job import collect_item

    try:
        return _with_job("item", lambda c: collect_item(c, ns.item, ns.run))
    except Exception as e:
        # 연결 끊김 등으로 단계 기록 전에 죽어도 화면이 '수집 중'에 멈추지 않게
        if ns.run is not None:
            with connect() as conn:
                conn.execute(
                    "update item_collect_runs set status = 'error', error = %s, finished_at = now() where id = %s and status <> 'done'",
                    (explain_error(e)[:500], ns.run),
                )
                conn.commit()
        raise


@command("series-check", "거시 통계 코드 점검(비활성 항목 포함, 실제 호출)")
def _series_check(ns):
    from .collectors.macro import check_series
    with connect() as conn:
        return check_series(conn)


_simple("indicators", "myrealty_etl.analytics.indicators:compute_indicators", "지역 지표·온도계 계산")
_simple("pois", "myrealty_etl.jobs.pois_job:collect_pois", "주변 편의시설 수집 + 입지 점수")
_simple("locations", "myrealty_etl.analytics.location:compute_locations", "입지 점수만 재계산")
_simple("location-check", "myrealty_etl.analytics.location_calibration:calibrate_locations",
        "입지 점수 검증(평당가 회귀: 설명력·항목별 효과·권장 가중치·점수 분포)",
        lambda p: p.add_argument("--months", type=int))


def _poi_args(p):
    p.add_argument("file")
    p.add_argument("--category", required=True,
                   choices=["subway", "bus", "school", "park", "mart", "hospital", "clinic", "academy", "food", "cafe", "convenience"])
    p.add_argument("--dataset", help="데이터셋 이름(기본: 파일명)")
    p.add_argument("--srid", type=int, default=5174, help="TM 좌표일 때 EPSG(대규모점포 LOCALDATA=5174)")


@command("import-poi", "표준데이터 CSV → POI (지하철역·버스정류장·학교·공원·대규모점포)", _poi_args)
def _import_poi(ns):
    from .collectors.pois import import_csv
    with connect() as conn:
        return import_csv(conn, ns.file, ns.category, ns.dataset, ns.srid)


def _geo_args(p):
    p.add_argument("file")
    p.add_argument("--kind", required=True, choices=["zones", "infra"])


@command("import-geo", "GeoJSON → 정비구역(zones)/인프라 사업(infra)", _geo_args)
def _import_geo(ns):
    from .collectors.projects import import_geojson, import_zones_csv
    with connect() as conn:
        if ns.file.endswith(".csv") and ns.kind == "zones":
            return import_zones_csv(conn, ns.file)
        return import_geojson(conn, ns.file, ns.kind)


_simple("avm", "myrealty_etl.analytics.avm:compute_valuations", "추정 시세(AVM) 계산")
_simple("avm-backtest", "myrealty_etl.analytics.avm:backtest", "AVM 오차(MAPE) 점검")
_simple("alerts", "myrealty_etl.alerts.rules:detect_alerts", "알림 규칙 평가")
_simple("push", "myrealty_etl.alerts.notify:send_push", "중요 알림 웹푸시 발송")
_simple("community", "myrealty_etl.community:run_community", "동네 이야기: 신고가·청약 시스템 글, 인기글 알림, 사진 정리")
_simple("digest", "myrealty_etl.alerts.notify:send_digest", "이메일 다이제스트 발송")
_simple("cleanup", "myrealty_etl.jobs.cleanup_job:cleanup_auth", "보관 기간이 지난 로그인 코드 기록·세션 삭제")


# 매일 파이프라인: 각 단계는 키가 없으면 건너뛰고, 실패해도 다음 단계를 계속한다.
DAILY_STEPS: list[tuple[str, str]] = [
    ("rtms", "myrealty_etl.jobs.rtms_job:collect_recent"),
    ("backfill", "myrealty_etl.jobs.rtms_job:backfill"),
    ("geocode", "myrealty_etl.transforms.geocode:geocode_pending"),
    ("link", "myrealty_etl.transforms.complexes:link_watch_items"),
    ("item_geom", "myrealty_etl.transforms.geocode:geocode_items"),
    ("macro", "myrealty_etl.collectors.macro:collect_macro"),
    ("attrs", "myrealty_etl.jobs.attrs_job:refresh_attrs"),
    ("rebuild", "myrealty_etl.jobs.rebuild_job:collect_rebuild_attrs"),
    ("events", "myrealty_etl.jobs.events_job:collect_events"),
    ("zones", "myrealty_etl.jobs.zones_job:collect_zones"),
    ("rail", "myrealty_etl.collectors.rail_seed:collect_rail_seed"),
    ("regulations", "myrealty_etl.collectors.regulations:collect_regulations"),
    ("news", "myrealty_etl.jobs.news_job:collect_news"),
    ("classify", "myrealty_etl.ai.news_classifier:classify_pending"),
    ("indicators", "myrealty_etl.analytics.indicators:compute_indicators"),
    ("pois", "myrealty_etl.jobs.pois_job:collect_pois"),
    ("location_check", "myrealty_etl.analytics.location_calibration:calibrate_locations"),
    ("avm", "myrealty_etl.analytics.avm:compute_valuations"),
    ("community", "myrealty_etl.community:run_community"),
    ("alerts", "myrealty_etl.alerts.rules:detect_alerts"),
    ("push", "myrealty_etl.alerts.notify:send_push"),
    ("digest", "myrealty_etl.alerts.notify:send_digest"),
    ("cleanup", "myrealty_etl.jobs.cleanup_job:cleanup_auth"),
]


@command("daily", "매일 파이프라인 전체 실행", lambda p: p.add_argument("--only", nargs="*", help="실행할 단계만"))
def _daily(ns):
    import importlib

    results = {}
    for name, target in DAILY_STEPS:
        if ns.only and name not in ns.only:
            continue
        mod, fn = target.split(":")
        func = getattr(importlib.import_module(mod), fn)
        try:
            results[name] = _with_job(name, func)
        except Exception as e:  # 한 단계 실패가 전체를 막지 않도록
            logging.getLogger("daily").exception("%s 실패", name)
            from .http import explain_error

            results[name] = {"error": explain_error(e)}
    return results


@command("doctor", "키·설정 점검(미설정·오설정 키를 실제 호출로 확인, 값 대신 지문 출력)",
         lambda p: p.add_argument("--strict", action="store_true", help="오류·필수 미설정이 있으면 실패 코드로 종료"))
def _doctor(ns):
    from .doctor import doctor
    return doctor(strict=ns.strict)


@command("seed-demo", "데모 데이터 생성(키 없이 화면 확인용)", _demo_args)
def _seed_demo(ns):
    from .demo import reset, seed_demo
    with connect() as conn:
        if ns.reset:
            reset(conn)
            return {"reset": True}
        if not ns.email:
            raise SystemExit("--email 이 필요합니다")
        return seed_demo(conn, ns.email)


@command("allow-email", "로그인 허용 이메일 추가", lambda p: p.add_argument("email"))
def _allow(ns):
    with connect() as conn:
        conn.execute("insert into allowed_emails (email) values (lower(%s)) on conflict do nothing", (ns.email,))
        conn.commit()
    return {"allowed": ns.email.lower()}


class _RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        from .http import redact

        msg = record.getMessage()
        clean = redact(msg)
        if record.exc_info and record.exc_info[1] is not None:
            record.exc_text = redact(logging.Formatter().formatException(record.exc_info))
        if clean != msg:
            record.msg, record.args = clean, None
        return True


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # httpx 는 INFO 로 요청 URL 전체(서비스키 포함)를 찍는다. 오류 메시지에도 URL 이 들어가므로 모든 로그에서 키를 가린다
    logging.getLogger("httpx").setLevel(logging.WARNING)
    for h in logging.getLogger().handlers:
        h.addFilter(_RedactFilter())
    parser = argparse.ArgumentParser(prog="myrealty")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name, (help_, _, add_args) in COMMANDS.items():
        p = sub.add_parser(name, help=help_)
        if add_args:
            add_args(p)
    ns = parser.parse_args(argv)
    result = COMMANDS[ns.cmd][1](ns)
    print(json.dumps(result, ensure_ascii=False, default=str, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
