from dataclasses import replace
from datetime import date

from myrealty_etl import config
from myrealty_etl.collectors import rtms
from myrealty_etl.jobs import item_job


def _setup(conn):
    uid = conn.execute("insert into users (email) values ('t@example.com') returning id").fetchone()["id"]
    item = conn.execute(
        """insert into watch_items (user_id, property_type, label, sgg_cd, lawd_cd, pnu, area_m2)
           values (%s, 'apt', '테스트', '11710', '1171010100', '1171010100100190000', 84.8) returning id::text as id""",
        (uid,),
    ).fetchone()["id"]
    conn.execute("insert into collect_targets (sgg_cd, name) values ('11710', '서울 송파구')")
    conn.commit()
    return item


def test_services_for():
    assert {(s.property_type, s.kind) for s in item_job.services_for("apt")} == {("apt", "sale"), ("apt", "rent")}
    assert [s.property_type for s in item_job.services_for("forest")] == ["land"]


def test_collect_item_runs_steps(conn, fixture_text, monkeypatch):
    item = _setup(conn)
    sale_items, _ = rtms.parse_xml(fixture_text("rtms_apt_trade.xml"))
    calls: list[tuple[str, str, str]] = []

    def fake_fetch(svc, sgg, ym, conn=None):
        calls.append((svc.property_type, svc.kind, ym))
        if svc.kind == "sale" and ym == "202608":
            return rtms.dedupe_hashes([rtms.normalize(i, svc, sgg) for i in sale_items])
        return []

    monkeypatch.setattr(rtms, "fetch", fake_fetch)
    monkeypatch.setattr(item_job, "settings", replace(config.settings, data_go_kr_key="test"))
    # 외부 호출이 필요한 단계는 이 테스트에서 건너뛴다
    for key in ("attrs", "location", "news"):
        monkeypatch.setitem(item_job.STEP_FNS, key, lambda c, it, today: {"skipped": "test"})

    out = item_job.collect_item(conn, item, today=date(2026, 9, 10))
    run = conn.execute("select status, steps, runner from item_collect_runs where id = %s", (out["run"],)).fetchone()
    assert run["status"] == "done" and run["runner"] == "cli"
    assert [k for k, _ in item_job.STEPS] == list(out)[1:]
    assert run["steps"]["trades"]["status"] == "done"
    assert run["steps"]["trades"]["detail"]["inserted"] == 4
    assert run["steps"]["attrs"]["status"] == "skipped"
    # 이 부동산 유형(아파트)만, 최근 12개월 → 과거(기본 36개월)까지
    assert {c[0] for c in calls} == {"apt"}
    months = sorted({c[2] for c in calls})
    assert len(months) == 36 and months[-1] == "202609" and months[0] == "202310"
    # 단지 연결·추정 시세
    w = conn.execute("select complex_id from watch_items where id = %s", (item,)).fetchone()
    assert w["complex_id"] is not None
    assert run["steps"]["valuation"]["status"] == "done"


def test_collect_item_missing(conn):
    item = _setup(conn)
    assert item_job.collect_item(conn, "00000000-0000-0000-0000-000000000000") == {"error": "not found"}
    # 웹이 만든 실행 기록이 있으면(그 사이 부동산이 삭제된 경우 등) 오류로 닫는다
    run = conn.execute("insert into item_collect_runs (watch_item_id) values (%s) returning id", (item,)).fetchone()["id"]
    conn.execute("delete from watch_items where id <> %s", (item,))
    conn.commit()
    item_job.collect_item(conn, "00000000-0000-0000-0000-000000000001", run)
    assert conn.execute("select status from item_collect_runs where id = %s", (run,)).fetchone()["status"] == "error"


def test_step_error_does_not_stop(conn, monkeypatch):
    item = _setup(conn)

    def boom(c, it, today):
        raise RuntimeError("x")

    for key in item_job.STEP_FNS:
        monkeypatch.setitem(item_job.STEP_FNS, key, boom if key == "trades" else (lambda c, it, today: {"ok": 1}))
    out = item_job.collect_item(conn, item)
    assert out["trades"]["status"] == "error"
    assert out["history"]["status"] == "done"
