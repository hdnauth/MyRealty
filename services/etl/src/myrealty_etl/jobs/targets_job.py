"""같은 시 다른 구 자동 수집(매일 파이프라인 `targets` 단계, 실거래 수집 앞).

구가 있는 시(수원·성남·용인·고양 …)는 생활권이 구 경계를 넘나드는데 수집은 시군구 단위라, 관심 부동산이 팔달구에 있으면
바로 옆 권선·장안구가 '아직 모으지 않은 지역'으로 비어 보였다. 관심 부동산이 있는 구의 같은 시 다른 구를 함께 켠다.
부하: 자동으로 켠 구는 과거 채우기를 12개월만(직접 등록한 지역은 36개월), 켜져 있는 수집 지역 상한(REGION_TARGET_CAP)을 넘지 않는다.
관리자가 끈 구(enabled=false)는 다시 켜지 않는다.
"""

from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)

# 구가 있는 시: 시 코드(앞 4자리) → [(시군구 코드, 구 이름)]
CITY_GU: dict[str, list[tuple[str, str]]] = {
    "4111": [("41111", "장안구"), ("41113", "권선구"), ("41115", "팔달구"), ("41117", "영통구")],  # 수원
    "4113": [("41131", "수정구"), ("41133", "중원구"), ("41135", "분당구")],  # 성남
    "4117": [("41171", "만안구"), ("41173", "동안구")],  # 안양
    "4127": [("41271", "상록구"), ("41273", "단원구")],  # 안산
    "4128": [("41281", "덕양구"), ("41285", "일산동구"), ("41287", "일산서구")],  # 고양
    "4146": [("41461", "처인구"), ("41463", "기흥구"), ("41465", "수지구")],  # 용인
    "4311": [("43111", "상당구"), ("43112", "서원구"), ("43113", "흥덕구"), ("43114", "청원구")],  # 청주
    "4413": [("44131", "동남구"), ("44133", "서북구")],  # 천안
    "5211": [("52111", "완산구"), ("52113", "덕진구")],  # 전주
    "4711": [("47111", "남구"), ("47113", "북구")],  # 포항
    "4812": [("48121", "의창구"), ("48123", "성산구"), ("48125", "마산합포구"), ("48127", "마산회원구"), ("48129", "진해구")],  # 창원
}
AUTO_BACKFILL_MONTHS = 12


def siblings(sgg_cd: str) -> list[tuple[str, str]]:
    return [(c, n) for c, n in CITY_GU.get(sgg_cd[:4], []) if c != sgg_cd]


def sibling_name(name: str | None, gu: str) -> str | None:
    """'경기도 수원시 팔달구' + '권선구' → '경기도 수원시 권선구'."""
    parts = (name or "").split()
    return " ".join([*parts[:-1], gu]) if len(parts) >= 2 else None


def expand_city_targets(conn, cap: int | None = None) -> dict:
    cap = cap if cap is not None else int(os.environ.get("REGION_TARGET_CAP") or 40)
    stats = {"enabled": 0, "skipped_cap": 0}
    rows = conn.execute(
        """select t.sgg_cd, t.name from collect_targets t
           where t.enabled and exists (select 1 from watch_items w where w.sgg_cd = t.sgg_cd)
           order by t.created_at"""
    ).fetchall()
    enabled = conn.execute("select count(*)::int as n from collect_targets where enabled").fetchone()["n"]
    for r in rows:
        for code, gu in siblings(r["sgg_cd"]):
            if conn.execute("select 1 from collect_targets where sgg_cd = %s", (code,)).fetchone():
                continue  # 이미 켜져 있거나 관리자가 끈 곳
            if enabled >= cap:
                stats["skipped_cap"] += 1
                continue
            conn.execute(
                """insert into collect_targets (sgg_cd, name, backfill_months, auto_from) values (%s, %s, %s, %s)
                   on conflict (sgg_cd) do nothing""",
                (code, sibling_name(r["name"], gu), AUTO_BACKFILL_MONTHS, r["sgg_cd"]),
            )
            conn.execute(
                """insert into regions (lawd_cd, sido, sigungu, level) values (%s, %s, %s, 2) on conflict (lawd_cd) do nothing""",
                (f"{code}00000", (r["name"] or "").split()[0] if r["name"] else None,
                 " ".join((sibling_name(r["name"], gu) or "").split()[1:]) or None),
            )
            enabled += 1
            stats["enabled"] += 1
            log.info("같은 시 다른 구 수집 켬: %s (%s 관심 부동산)", code, r["sgg_cd"])
    conn.commit()
    return stats
