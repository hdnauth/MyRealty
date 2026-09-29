import json
from datetime import UTC, datetime
from types import SimpleNamespace as NS

from myrealty_etl.ai import client as ai
from myrealty_etl.ai import news_classifier as nc
from myrealty_etl.collectors import naver_news
from myrealty_etl.jobs import news_job


def test_parse_naver_item():
    it = naver_news.parse_item({
        "title": "[단독] <b>잠실엘스</b> 신고가 &quot;27억&quot;",
        "originallink": "https://www.example-news.co.kr/a/1",
        "link": "https://n.news.naver.com/x",
        "description": "송파구 <b>잠실</b>동...",
        "pubDate": "Mon, 21 Sep 2026 09:30:00 +0900",
    })
    assert it["title"] == '[단독] 잠실엘스 신고가 "27억"'
    assert it["source"] == "example-news.co.kr"
    assert it["published_at"].year == 2026
    assert it["title_norm"] == naver_news.title_norm('잠실엘스 신고가 "27억"')


def _msg(payload, stop="end_turn"):
    return NS(stop_reason=stop, model="claude-opus-5", content=[NS(type="text", text=json.dumps(payload, ensure_ascii=False))],
              usage=NS(input_tokens=500, output_tokens=80, cache_read_input_tokens=0, cache_creation_input_tokens=0))


def test_build_params_and_parse():
    item = {"property_type": "apt", "label": "우리집", "building_name": "잠실엘스", "road_address": "올림픽로 99", "keywords": ["잠실엘스"]}
    p = nc.build_params("claude-opus-5", item, {"title": "t", "description": "d"})
    assert p["output_config"]["format"]["schema"]["additionalProperties"] is False
    assert p["output_config"]["effort"] == "low"
    assert "effort" not in nc.build_params("claude-haiku-4-5", item, {"title": "t"})["output_config"]
    d = nc.parse_result(_msg({"relevance": 1.4, "category": "재건축", "impact": 1, "summary": "요약", "affected_regions": []}))
    assert d["relevance"] == 1.0


def _seed(conn):
    uid = conn.execute("insert into users (email) values ('n@example.com') returning id").fetchone()["id"]
    wid = conn.execute(
        "insert into watch_items (user_id, property_type, label, sgg_cd, keywords) values (%s, 'apt', '잠실엘스', '11710', '{잠실엘스}') returning id",
        (uid,),
    ).fetchone()["id"]
    a = naver_news.parse_item({"title": "잠실엘스 재건축 논의", "originallink": "https://e.com/1", "pubDate": datetime.now(UTC).strftime("%a, %d %b %Y %H:%M:%S +0000")})
    aid = news_job.upsert_article(conn, a)
    # 같은 제목의 다른 언론사 기사는 합쳐진다
    a2 = dict(a, url="https://other.com/9")
    assert news_job.upsert_article(conn, a2) == aid
    assert news_job.link(conn, aid, wid, "11710", "잠실엘스")
    assert not news_job.link(conn, aid, wid, "11710", "잠실엘스")
    conn.commit()
    return wid


def test_classify_sync(conn, monkeypatch):
    _seed(conn)
    fake = NS(messages=NS(
        create=lambda **kw: _msg({"relevance": 0.9, "category": "재건축", "impact": 1, "summary": "재건축 논의 시작", "affected_regions": ["잠실동"]}),
        batches=NS(retrieve=None, results=None, create=None),
    ))
    monkeypatch.setattr(ai, "get_client", lambda: fake)
    monkeypatch.setattr(nc.ai, "get_client", lambda: fake)
    conn.execute("update ai_batches set status = 'applied'")
    stats = nc.classify_pending(conn, mode="sync")
    assert stats["classified_sync"] == 1
    row = conn.execute("select status, relevance, category, impact from article_links").fetchone()
    assert row["status"] == "classified" and abs(row["relevance"] - 0.9) < 1e-6 and row["impact"] == 1
    assert conn.execute("select count(*) as n from ai_usage").fetchone()["n"] == 1


def test_classify_batch_roundtrip(conn, monkeypatch):
    _seed(conn)
    submitted = {}

    def create(requests):
        submitted["requests"] = requests
        return NS(id="msgbatch_1")

    def results(bid):
        for r in submitted["requests"]:
            yield NS(custom_id=r["custom_id"], result=NS(type="succeeded", message=_msg(
                {"relevance": 0.2, "category": "기타", "impact": 0, "summary": "무관", "affected_regions": []})))

    fake = NS(messages=NS(batches=NS(create=create, retrieve=lambda bid: NS(processing_status="ended"), results=results)))
    monkeypatch.setattr(nc.ai, "get_client", lambda: fake)
    s1 = nc.classify_pending(conn, mode="batch")
    assert s1["batch_submitted"]["count"] == 1
    assert conn.execute("select status from article_links").fetchone()["status"] == "queued"
    s2 = nc.classify_pending(conn, mode="batch")
    assert s2["polled"]["applied"] == 1
    assert conn.execute("select status from article_links").fetchone()["status"] == "classified"
    assert conn.execute("select batch from ai_usage").fetchone()["batch"] is True


def test_rejects_non_http_links():
    it = naver_news.parse_item({"title": "t", "originallink": "javascript:alert(1)", "link": "https://n.news.naver.com/a"})
    assert it["url"] == "https://n.news.naver.com/a"
    assert naver_news.parse_item({"title": "t", "originallink": "javascript:x"})["url"] is None


def test_naver_endpoint_order_by_key_format():
    from myrealty_etl.collectors import naver_news

    # 네이버 클라우드 API HUB 형식(ID 10자·Secret 40자) → API HUB 먼저
    assert naver_news.endpoints("a" * 10, "b" * 40)[0][0] == "apihub"
    # 개발자센터 형식(ID 20자·Secret 10자) → 개발자센터 먼저
    assert naver_news.endpoints("a" * 20, "b" * 10)[0][0] == "developers"


def test_naver_request_falls_back_on_auth_error():
    import httpx

    from myrealty_etl.collectors import naver_news

    calls = []

    def fake_get(url, params=None, headers=None):
        calls.append(url)
        req = httpx.Request("GET", url)
        if url == naver_news.APIHUB_URL:
            return httpx.Response(401, request=req, json={"error": "auth"})
        return httpx.Response(200, request=req, json={"items": [{"title": "t", "link": "https://n.news/1"}]})

    naver_news._working = None
    data = naver_news.request("부동산", 1, "a" * 10, "b" * 40, get=fake_get)
    assert calls == [naver_news.APIHUB_URL, naver_news.URL]
    assert data["items"][0]["title"] == "t"
    naver_news._working = None
