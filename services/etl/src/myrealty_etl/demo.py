"""데모 데이터: API 키 없이 화면·기능을 확인하기 위한 합성 데이터.

모든 합성 행은 식별 가능한 접두사(demo)를 가지므로 `seed-demo --reset` 으로 지울 수 있다.
가격은 실제 시세가 아니다.
"""

from __future__ import annotations

import hashlib
import math
import random
from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

from .db import jsonb

SGG = "11710"
SGG_NAME = "서울특별시 송파구"
REGIONS = [
    ("1171000000", "서울특별시", "송파구", None, 2, None),
    ("1171010100", "서울특별시", "송파구", "잠실동", 3, (127.0842, 37.5080)),
    ("1171010200", "서울특별시", "송파구", "신천동", 3, (127.0990, 37.5190)),
    ("1171010600", "서울특별시", "송파구", "석촌동", 3, (127.1005, 37.5020)),
    ("4183000000", "경기도", "양평군", None, 2, None),
    ("4183031021", "경기도", "양평군", "양서면 목왕리", 3, (127.3860, 37.5560)),
]
# (key, name, umd, lawd, jibun, lng, lat, households, build_year, base_ppy(만원/평, 2021-01 기준))
COMPLEXES = [
    ("demo:els", "잠실엘스", "잠실동", "1171010100", "19", 127.0806, 37.5116, 5678, 2008, 6500),
    ("demo:ricenz", "리센츠", "잠실동", "1171010100", "22", 127.0845, 37.5125, 5563, 2008, 6400),
    ("demo:trizium", "트리지움", "잠실동", "1171010100", "27", 127.0876, 37.5093, 3696, 2007, 6000),
    ("demo:lake", "레이크팰리스", "잠실동", "1171010100", "35", 127.0905, 37.5070, 2678, 2006, 5900),
    ("demo:parkrio", "파크리오", "신천동", "1171010200", "17", 127.1033, 37.5213, 6864, 2008, 5700),
]
AREAS = [59.9, 84.8, 119.9]


def market_index(d: date) -> float:
    """2021-01 = 1.0 기준 합성 지수: 2021 급등 → 2022~23 조정 → 2024~ 회복."""
    t = (d.year - 2021) * 12 + (d.month - 1)
    if t < 0:  # 2016~2020 상승기
        return 1.0 * math.exp(0.0085 * t)
    if t <= 12:
        return 1.0 + 0.012 * t
    if t <= 30:
        return 1.144 - 0.011 * (t - 12)
    return 0.946 + 0.0068 * (t - 30) + 0.01 * math.sin(t / 3)


def _hash(*parts) -> str:
    return "demo-" + hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:30]


def reset(conn) -> None:
    conn.execute("delete from transactions where src_hash like 'demo-%%'")
    conn.execute("delete from complexes where complex_key like 'demo:%%'")
    conn.execute("delete from series where source = 'demo'")
    conn.execute("delete from articles where url like 'https://demo.myrealty.local/%%'")
    conn.execute("delete from events where source_key like 'demo:%%'")
    conn.commit()


def seed_demo(conn, email: str, *, today: date | None = None, years: int = 8) -> dict:
    today = today or date.today()
    rnd = random.Random(42)
    reset(conn)
    email = email.strip().lower()
    conn.execute("insert into allowed_emails (email, note) values (%s, 'demo') on conflict do nothing", (email,))
    user = conn.execute(
        "insert into users (email) values (%s) on conflict (email) do update set email = excluded.email returning id",
        (email,),
    ).fetchone()
    uid = user["id"]

    for lawd, sido, sgg, emd, level, center in REGIONS:
        conn.execute(
            """insert into regions (lawd_cd, sido, sigungu, emd, level, center)
               values (%s, %s, %s, %s, %s, case when %s::float8 is null then null else ST_SetSRID(ST_MakePoint(%s, %s), 4326) end)
               on conflict (lawd_cd) do update set sido = excluded.sido, sigungu = excluded.sigungu, emd = excluded.emd,
                 center = coalesce(excluded.center, regions.center)""",
            (lawd, sido, sgg, emd, level, center and center[0], center and center[0], center and center[1]),
        )
    for sgg_cd, name in ((SGG, SGG_NAME), ("41830", "경기도 양평군")):
        conn.execute("insert into collect_targets (sgg_cd, name) values (%s, %s) on conflict do nothing", (sgg_cd, name))

    n_tx = 0
    start = today.replace(day=1) - relativedelta(years=years)
    complex_ids: dict[str, int] = {}
    for key, name, umd, lawd, jibun, lng, lat, hh, by, base in COMPLEXES:
        cid = conn.execute(
            """insert into complexes (complex_key, property_type, name, name_norm, sgg_cd, lawd_cd, umd_nm, jibun, households,
                 build_year, geom, pnu)
               values (%s, 'apt', %s, %s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)
               returning id""",
            (key, name, name.replace(" ", ""), SGG, lawd, umd, jibun, hh, by, lng, lat, f"{lawd}1{int(jibun):04d}0000"),
        ).fetchone()["id"]
        complex_ids[key] = cid
        rows = []
        m = start
        while m <= today:
            idx = market_index(m)
            # 거래량: 2022~23 급감
            vol = 3 if date(2022, 4, 1) <= m <= date(2023, 8, 1) else 8
            for _ in range(rnd.randint(max(1, vol - 2), vol + 2)):
                area = rnd.choice(AREAS)
                day = min(m + timedelta(days=rnd.randint(0, 27)), today)
                if day > today - timedelta(days=3):
                    continue
                py = area / 3.305785
                area_prem = 1.0 + (0.06 if area < 70 else 0.0 if area < 100 else -0.03)
                floor = rnd.randint(1, 30)
                floor_adj = 0.97 if floor <= 3 else 1.02 if floor >= 15 else 1.0
                price = round(base * idx * area_prem * floor_adj * py * rnd.gauss(1, 0.025) / 100) * 100
                kind = rnd.random()
                if kind < 0.45:
                    rows.append(("sale", day, area, floor, price, 0))
                elif kind < 0.85:
                    jr = 0.52 + 0.05 * math.sin((m.year - 2020) / 2)
                    rows.append(("jeonse", day, area, floor, round(price * jr / 500) * 500, 0))
                else:
                    rows.append(("wolse", day, area, floor, round(price * 0.2 / 1000) * 1000, rnd.choice([150, 200, 250, 300])))
            m += relativedelta(months=1)
        for i, (kind, day, area, floor, price, rent) in enumerate(rows):
            canceled = kind == "sale" and rnd.random() < 0.02
            conn.execute(
                """insert into transactions (src_hash, property_type, deal_kind, sgg_cd, lawd_cd, umd_nm, jibun, complex_id, name,
                     area_m2, floor, build_year, deal_date, price, monthly_rent, is_direct, is_canceled, canceled_at, geom, raw)
                   values (%s, 'apt', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                     ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)""",
                (_hash(key, i, day, price), kind, SGG, lawd, umd, jibun, cid, name, area, floor, by, day, price,
                 rent if kind == "wolse" else None, rnd.random() < 0.05, canceled,
                 day + timedelta(days=20) if canceled else None, lng, lat, jsonb({"demo": True})),
            )
            n_tx += 1

    # 석촌동 빌라, 양평 임야
    m = start
    while m <= today:
        idx = market_index(m)
        for j in range(rnd.randint(2, 5)):
            area = rnd.choice([42.0, 49.5, 59.8])
            price = round(2600 * idx * area / 3.305785 * rnd.gauss(1, 0.06) / 100) * 100
            day = min(m + timedelta(days=rnd.randint(0, 27)), today - timedelta(days=4))
            conn.execute(
                """insert into transactions (src_hash, property_type, deal_kind, sgg_cd, lawd_cd, umd_nm, jibun, name, house_type,
                     area_m2, land_area_m2, floor, build_year, deal_date, price, geom, raw)
                   values (%s, 'rowhouse', 'sale', %s, '1171010600', '석촌동', %s, %s, '다세대', %s, %s, %s, %s, %s, %s,
                     ST_SetSRID(ST_MakePoint(%s, %s), 4326), '{"demo": true}')""",
                (_hash("rh", m, j), SGG, f"{200 + j}-{rnd.randint(1, 30)}", f"석촌빌라{j + 1}", area, area * 0.45,
                 rnd.randint(1, 5), rnd.choice([2003, 2012, 2018]), day, price,
                 127.1005 + rnd.uniform(-0.004, 0.004), 37.5020 + rnd.uniform(-0.003, 0.003)),
            )
            n_tx += 1
        if rnd.random() < 0.6:
            area = rnd.choice([990.0, 1523.0, 3300.0, 6612.0])
            ppm2 = 9.5 * (0.9 + 0.1 * idx) * rnd.gauss(1, 0.2)  # 만원/㎡
            day = min(m + timedelta(days=rnd.randint(0, 27)), today - timedelta(days=4))
            conn.execute(
                """insert into transactions (src_hash, property_type, deal_kind, sgg_cd, lawd_cd, umd_nm, jibun, jimok, land_use,
                     area_m2, deal_date, price, geom, raw)
                   values (%s, 'land', 'sale', '41830', '4183031021', '양서면 목왕리', '산1**', '임야', '계획관리', %s, %s, %s,
                     ST_SetSRID(ST_MakePoint(127.3860, 37.5560), 4326), '{"demo": true}')""",
                (_hash("land", m), area, day, round(area * ppm2)),
            )
            n_tx += 1
        m += relativedelta(months=1)

    # 관심 물건
    conn.execute("delete from watch_items where user_id = %s and label like '[데모]%%'", (uid,))
    items = [
        ("apt", "[데모] 우리집 잠실엘스", "owned", "서울특별시 송파구 올림픽로 99", "서울특별시 송파구 잠실동 19",
         "잠실엘스", "1171010100", complex_ids["demo:els"], 84.8, None, 15, (127.0806, 37.5116), 150000, date(2019, 6, 20),
         [{"name": "주택담보대출", "amount": 60000, "rate": 3.8, "years": 30, "maturity": "2049-06-20"}], None,
         ["잠실엘스", "잠실동 아파트", "송파구 부동산"], 1000),
        ("apt", "[데모] 매수후보 파크리오", "candidate", "서울특별시 송파구 올림픽로 435", "서울특별시 송파구 신천동 17",
         "파크리오", "1171010200", complex_ids["demo:parkrio"], 84.8, None, 10, (127.1033, 37.5213), None, None, [], None,
         ["파크리오", "신천동 아파트", "송파구 부동산"], 1000),
        ("forest", "[데모] 양평 임야", "watch", None, "경기도 양평군 양서면 목왕리 산 12", None, "4183031021", None, None,
         1523.0, None, (127.3860, 37.5560), 11000, date(2021, 3, 2), [], None, ["양서면 토지", "양평군 부동산"], 3000),
    ]
    for (ptype, label, group, road, jibun_addr, bname, lawd, cid, area, land_area, floor, pt, pp, pd, loans, lease,
         keywords, radius) in items:
        conn.execute(
            """insert into watch_items (user_id, property_type, label, group_tag, road_address, jibun_address, building_name,
                 lawd_cd, sgg_cd, pnu, complex_id, area_m2, land_area_m2, floor, geom, purchase_price, purchase_date, loans,
                 lease, keywords, radius_m)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s,
                 %s, %s, %s, %s, %s)""",
            (uid, ptype, label, group, road, jibun_addr, bname, lawd, lawd[:5],
             f"{lawd}{'2' if ptype == 'forest' else '1'}{12 if ptype == 'forest' else 19:04d}0000", cid, area, land_area,
             floor, pt[0], pt[1], pp, pd, jsonb(loans), jsonb(lease) if lease else None, keywords, radius),
        )
    # 신고 지연을 흉내: 수집 시각 = 계약일 + 25일
    conn.execute(
        "update transactions set collected_at = least(now(), deal_date + interval '25 days') where src_hash like 'demo-%%'"
    )
    _seed_attrs(conn, today)
    n_news = _seed_news_events(conn, uid, today)
    conn.commit()
    return {"user_id": str(uid), "transactions": n_tx, "complexes": len(complex_ids), "items": len(items), **n_news}


DEMO_NEWS = [
    # (item label 접미, 제목, 요약, 관련도, 카테고리, 영향, AI 요약, 며칠 전)
    ("잠실엘스", "잠실 일대 토지거래허가구역 1년 연장…실거주 의무 유지", "서울시는 잠실·삼성·대치·청담동 토지거래허가구역 지정을 1년 연장했다.",
     0.92, "규제", -1, "잠실동 토지거래허가 연장으로 갭투자 제한이 이어져 매수 수요가 제약됨", 2),
    ("잠실엘스", "송파구 대단지 전세가 상승세…잠실엘스 84㎡ 11억 돌파", "신규 입주 물량 감소로 송파구 전세가격이 오름세를 보이고 있다.",
     0.88, "시장동향", 1, "잠실엘스 전세가 상승으로 전세가율이 오르며 매매가 하방을 지지", 4),
    ("잠실엘스", "잠실동 재건축 단지 정비계획 변경안 통과", "잠실동 인근 노후 단지의 정비계획 변경안이 도시계획위원회를 통과했다.",
     0.74, "재건축", 1, "인근 재건축 진척은 잠실동 전반의 가격 기대를 높이는 요인", 6),
    ("파크리오", "신천동 일대 대형 복합개발 착공 예정", "신천동 일대 업무·상업 복합개발이 내년 착공을 목표로 인허가 절차를 밟고 있다.",
     0.81, "개발", 1, "파크리오 인근 복합개발로 생활 인프라 개선 기대(확정 전)", 3),
    ("양평", "양평군 계획관리지역 개발행위 기준 강화 검토", "양평군이 난개발 방지를 위해 계획관리지역 개발행위허가 기준 강화를 검토 중이다.",
     0.77, "규제", -1, "계획관리지역 임야의 개발 가능성이 낮아질 수 있어 토지 가치에 부담", 5),
    ("잠실엘스", "주택담보대출 스트레스 DSR 3단계 시행", "금융당국이 스트레스 DSR 3단계를 시행하며 대출 한도가 줄어든다.",
     0.62, "대출", -1, "대출 한도 축소로 고가 아파트 매수 여력이 감소", 8),
]


def _seed_news_events(conn, uid, today: date) -> dict:
    items = {r["label"]: r["id"] for r in conn.execute("select id, label from watch_items where user_id = %s", (uid,))}
    n = 0
    for i, (suffix, title, desc, rel, cat, impact, summary, days) in enumerate(DEMO_NEWS):
        item_id = next((v for k, v in items.items() if suffix in k), None)
        if not item_id:
            continue
        aid = conn.execute(
            """insert into articles (url, title, description, source, published_at, title_norm)
               values (%s, %s, %s, 'demo-news.local', now() - %s::interval, %s)
               on conflict (url) do update set title = excluded.title returning id""",
            (f"https://demo.myrealty.local/news/{i}", f"[데모] {title}", desc, f"{days} days", f"demo{i}"),
        ).fetchone()["id"]
        conn.execute(
            """insert into article_links (article_id, watch_item_id, query, status, relevance, category, impact, ai_summary, classified_at)
               values (%s, %s, 'demo', 'classified', %s, %s, %s, %s, now() - %s::interval) on conflict do nothing""",
            (aid, item_id, rel, cat, impact, summary, f"{days} days"),
        )
        n += 1
    conn.execute(
        """insert into events (source_key, kind, title, starts_on, ends_on, address, geom, payload, source_url)
           values ('demo:sub1', 'subscription', '[데모] 잠실 르엘', %s, %s, '서울특별시 송파구 잠실동 일대',
             ST_SetSRID(ST_MakePoint(127.0930, 37.5105), 4326), '{"households": 1865, "house_type": "APT"}',
             'https://www.applyhome.co.kr'),
                  ('demo:movein1', 'move_in', '[데모] 잠실 르엘 입주 예정', %s, null, '서울특별시 송파구 잠실동 일대',
             ST_SetSRID(ST_MakePoint(127.0930, 37.5105), 4326), '{"households": 1865}', null)
           on conflict (source_key) do nothing""",
        (today + timedelta(days=5), today + timedelta(days=7), date(today.year + 3, 3, 1)),
    )
    from .alerts.rules import detect_alerts
    from .jobs.events_job import annual_events

    annual_events(conn, today)
    conn.execute("delete from notifications where user_id = %s", (uid,))
    from datetime import datetime

    alerts = detect_alerts(conn, datetime.now().astimezone() - timedelta(days=30))
    return {"news": n, "alerts": {k: v for k, v in alerts.items() if k != "since"}}


def _seed_attrs(conn, today: date) -> None:
    els = "1171010100100190000"
    forest = "4183031021200120000"
    conn.execute(
        """insert into building_registers (pnu, titles, recap) values (%s, %s, %s)
           on conflict (pnu) do update set titles = excluded.titles, recap = excluded.recap, fetched_at = now()""",
        (els, jsonb([{"bld_nm": "잠실엘스", "dong_nm": "101동", "main_purpose": "공동주택", "structure": "철근콘크리트구조",
                      "approved_at": "2008-09-30", "floors_above": 33, "floors_below": 3, "households": 132}]),
         jsonb({"bld_nm": "잠실엘스", "households": 5678, "vl_rat": 274.8, "bc_rat": 13.9, "parking": 9510})),
    )
    conn.execute(
        """insert into parcels (pnu, lawd_cd, jimok, area_m2, land_use_zone, road_side, terrain_shape, terrain_height, land_uses)
           values (%s, '4183031021', '임야', 1523, '{계획관리지역}', '맹지', '부정형', '완경사', %s)
           on conflict (pnu) do update set land_uses = excluded.land_uses""",
        (forest, jsonb([{"name": "계획관리지역"}, {"name": "자연보전권역"}, {"name": "배출시설설치제한지역"}])),
    )
    for i, y in enumerate(range(today.year - 5, today.year + 1)):
        conn.execute(
            """insert into official_prices (target_type, target_key, year, price, area_m2) values ('apt_unit', %s, %s, %s, 84.8)
               on conflict do nothing""",
            (f"{els}||", y, int((1_150_000_000 + 60_000_000 * i) * (1.18 if y == 2022 else 1.0))),
        )
        conn.execute(
            "insert into official_prices (target_type, target_key, year, price) values ('land', %s, %s, %s) on conflict do nothing",
            (forest, y, 36000 + 1100 * i),
        )
