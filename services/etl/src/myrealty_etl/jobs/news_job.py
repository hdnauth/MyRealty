"""관심 물건 키워드별 뉴스 수집 → article_links(pending) 생성. 분류는 ai.news_classifier."""

from __future__ import annotations

import logging

from ..collectors import naver_news
from ..config import settings

log = logging.getLogger(__name__)


def upsert_article(conn, a: dict) -> int:
    # 같은 제목(언론사만 다른 기사)이 3일 내 있으면 기존 기사로 합친다
    dup = conn.execute(
        """select id from articles where title_norm = %s and url <> %s
             and published_at > coalesce(%s::timestamptz, now()) - interval '3 days' limit 1""",
        (a["title_norm"], a["url"], a["published_at"]),
    ).fetchone()
    if dup:
        return dup["id"]
    row = conn.execute(
        """insert into articles (url, title, description, source, kind, published_at, title_norm)
           values (%s, %s, %s, %s, 'news', %s, %s)
           on conflict (url) do update set title = excluded.title
           returning id""",
        (a["url"], a["title"], a["description"], a["source"], a["published_at"], a["title_norm"]),
    ).fetchone()
    return row["id"]


def link(conn, article_id: int, item_id: str, sgg_cd: str | None, query: str) -> bool:
    res = conn.execute(
        """insert into article_links (article_id, watch_item_id, sgg_cd, query) values (%s, %s, %s, %s)
           on conflict do nothing""",
        (article_id, item_id, sgg_cd, query),
    )
    return res.rowcount > 0


def collect_news(conn, per_query: int = 30) -> dict:
    if not (settings.naver_client_id and settings.naver_client_secret):
        return {"skipped": "NAVER_CLIENT_ID/SECRET 미설정"}
    stats = {"queries": 0, "articles": 0, "links": 0}
    items = conn.execute("select id, sgg_cd, keywords from watch_items where cardinality(keywords) > 0").fetchall()
    cache: dict[str, list[dict]] = {}
    for it in items:
        for q in it["keywords"]:
            if q not in cache:
                try:
                    cache[q] = naver_news.search(q, per_query, conn)
                    stats["queries"] += 1
                except Exception as e:
                    log.warning("뉴스 검색 실패 %s: %s", q, e)
                    cache[q] = []
            for a in cache[q]:
                aid = upsert_article(conn, a)
                stats["articles"] += 1
                if link(conn, aid, it["id"], it["sgg_cd"], q):
                    stats["links"] += 1
            conn.commit()
    return stats
