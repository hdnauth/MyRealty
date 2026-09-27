"""실거래 행 ↔ 단지(complexes) 매칭. 없으면 새로 만든다."""

from __future__ import annotations

from ..codes import make_pnu, normalize_name
from ..collectors.rtms import complex_key

COMPLEX_TYPES = {"apt": "apt", "presale": "apt", "officetel": "officetel", "rowhouse": "rowhouse"}


class ComplexMatcher:
    def __init__(self, conn):
        self.conn = conn
        self.cache: dict[tuple, int | None] = {}

    def _find(self, ptype: str, sgg: str, umd: str | None, jibun: str | None, nn: str) -> int | None:
        row = self.conn.execute(
            """select id from complexes
               where sgg_cd = %s and property_type = %s and coalesce(umd_nm, '') = coalesce(%s, '')
                 and (name_norm = %s or %s = any(aliases))
               order by (jibun is not distinct from %s) desc, id
               limit 1""",
            (sgg, ptype, umd, nn, nn, jibun),
        ).fetchone()
        return row["id"] if row else None

    def _upsert(self, key: str, ptype: str, row: dict, nn: str) -> int:
        res = self.conn.execute(
            """insert into complexes (complex_key, property_type, name, name_norm, sgg_cd, lawd_cd, umd_nm, jibun, build_year, pnu)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               on conflict (complex_key) do update set
                 lawd_cd = coalesce(complexes.lawd_cd, excluded.lawd_cd),
                 pnu = coalesce(complexes.pnu, excluded.pnu),
                 build_year = coalesce(complexes.build_year, excluded.build_year),
                 aliases = case when excluded.name_norm = complexes.name_norm or excluded.name_norm = any(complexes.aliases)
                                then complexes.aliases else complexes.aliases || excluded.name_norm end,
                 updated_at = now()
               returning id""",
            (key, ptype, row.get("name"), nn, row["sgg_cd"], row.get("lawd_cd"), row.get("umd_nm"), row.get("jibun"),
             row.get("build_year"), make_pnu(row["lawd_cd"], row.get("jibun")) if row.get("lawd_cd") else None),
        ).fetchone()
        return res["id"]

    def match(self, row: dict) -> int | None:
        ptype = COMPLEX_TYPES.get(row["property_type"])
        if not ptype:
            return None
        nn = normalize_name(row.get("name"))
        if not nn:
            return None
        ck = (ptype, row["sgg_cd"], row.get("umd_nm"), row.get("jibun"), nn, row.get("apt_seq"))
        if ck in self.cache:
            return self.cache[ck]
        cid: int | None
        if row.get("apt_seq"):
            cid = self._upsert(f"apt:{row['apt_seq']}", ptype, row, nn)
        else:
            cid = self._find(ptype, row["sgg_cd"], row.get("umd_nm"), row.get("jibun"), nn)
            if cid is None:
                key = complex_key(row)
                cid = self._upsert(key, ptype, row, nn) if key else None
        self.cache[ck] = cid
        return cid

    def assign(self, rows: list[dict]) -> list[dict]:
        for r in rows:
            r["complex_id"] = self.match(r)
        self.conn.commit()
        return rows


def link_watch_items(conn) -> dict:
    """단지가 아직 연결되지 않은 관심 부동산을 PNU·지번으로 단지와 연결하고 좌표를 채운다."""
    linked = conn.execute(
        """update watch_items w set complex_id = c.id, updated_at = now()
           from complexes c
           where w.complex_id is null and w.property_type in ('apt', 'officetel', 'rowhouse')
             and c.property_type = w.property_type and c.sgg_cd = w.sgg_cd
             and (c.pnu = w.pnu or (w.pnu is not null and c.lawd_cd = substr(w.pnu, 1, 10)
                  and c.jibun = (ltrim(substr(w.pnu, 12, 4), '0') ||
                                 case when substr(w.pnu, 16, 4) <> '0000' then '-' || ltrim(substr(w.pnu, 16, 4), '0') else '' end)))"""
    ).rowcount
    geom = conn.execute(
        """update watch_items w set geom = c.geom from complexes c
           where w.complex_id = c.id and w.geom is null and c.geom is not null"""
    ).rowcount
    # 단지 좌표가 없고 관심 부동산 좌표가 있으면 단지에 전파(지오코딩 절약)
    back = conn.execute(
        """update complexes c set geom = w.geom from watch_items w
           where w.complex_id = c.id and c.geom is null and w.geom is not null"""
    ).rowcount
    conn.commit()
    return {"linked": linked, "item_geom": geom, "complex_geom": back}
