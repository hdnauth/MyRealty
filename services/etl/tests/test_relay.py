"""국내 API 중계·키 정규화·오류 설명·OSM 분류·관심 부동산 좌표 채우기."""

from dataclasses import replace

import httpx
import pytest

from myrealty_etl import config, http
from myrealty_etl.collectors import osm


def test_service_key_and_app_url(monkeypatch):
    monkeypatch.setenv("DATA_GO_KR_KEY", ' "abc%2Bdef%3D%3D"\n')
    monkeypatch.setenv("APP_URL", "myrealty.vercel.app/")
    s = config.Settings()
    assert s.data_go_kr_key == "abc+def=="
    assert s.app_url == "https://myrealty.vercel.app"
    monkeypatch.setenv("APP_URL", "http://localhost:3000")
    assert config.Settings().app_url == "http://localhost:3000"


def _resp(status: int, text: str, url: str) -> httpx.Response:
    return httpx.Response(status, text=text, request=httpx.Request("GET", url))


@pytest.fixture
def relay_settings(monkeypatch):
    s = replace(config.settings, cron_secret="secret", app_url="https://app.example", kr_relay="auto")
    monkeypatch.setattr(http, "settings", s)
    http._relayed.clear()
    yield s
    http._relayed.clear()


def test_relay_on_forbidden(monkeypatch, relay_settings):
    calls: list[tuple[str, dict]] = []

    class FakeClient:
        def get(self, url, params=None, headers=None, timeout=None):
            calls.append((url, dict(params or {})))
            if url.startswith("https://apis.data.go.kr"):
                return _resp(403, "<resultCode>30</resultCode>", url)
            assert headers["Authorization"] == "Bearer secret"
            r = _resp(200, "<ok/>", url)
            r.headers["x-relay"] = "1"
            return r

    monkeypatch.setattr(http, "client", lambda: FakeClient())
    r = http.get("https://apis.data.go.kr/1613000/X/getX", params={"serviceKey": "k", "LAWD_CD": "11110"})
    assert r.text == "<ok/>"
    relay_url, relay_params = calls[1]
    assert relay_url == "https://app.example/api/relay"
    # 키는 보내지 않는다(웹이 자기 키를 붙인다)
    assert "serviceKey" not in relay_params and relay_params["LAWD_CD"] == "11110"
    assert "apis.data.go.kr" in http._relayed
    # 두 번째부터는 바로 중계
    http.get("https://apis.data.go.kr/1613000/X/getX", params={"serviceKey": "k"})
    assert calls[2][0] == "https://app.example/api/relay"


def test_no_relay_for_other_hosts(monkeypatch, relay_settings):
    class FakeClient:
        def get(self, url, params=None, headers=None, timeout=None):
            return _resp(403, "", url)

    monkeypatch.setattr(http, "client", lambda: FakeClient())
    with pytest.raises(httpx.HTTPStatusError):
        http.get("https://openapi.naver.com/v1/search/news.json")


def test_relay_failure_raises_original(monkeypatch, relay_settings):
    class FakeClient:
        def get(self, url, params=None, headers=None, timeout=None):
            if "app.example" in url:
                r = _resp(424, '{"error":"no key"}', url)
                r.headers["x-relay"] = "1"
                return r
            return _resp(403, "<resultCode>30</resultCode>", url)

    monkeypatch.setattr(http, "client", lambda: FakeClient())
    with pytest.raises(httpx.HTTPStatusError) as ei:
        http.get("https://apis.data.go.kr/1613000/X/getX")
    assert "apis.data.go.kr" in str(ei.value.request.url)
    assert "apis.data.go.kr" not in http._relayed


def test_explain_error(relay_settings):
    url = "https://apis.data.go.kr/1613000/X/getX?serviceKey=zzz"
    e = httpx.HTTPStatusError("x", request=httpx.Request("GET", url), response=_resp(403, "<returnReasonCode>30</returnReasonCode>", url))
    msg = http.explain_error(e)
    assert msg.startswith("공공데이터포털") and "등록되지 않은 서비스키" in msg and "zzz" not in msg
    assert "한도" in http.explain_error(http.QuotaExceeded("data.go.kr 일일 호출 한도(900) 초과"))
    t = httpx.RemoteProtocolError("Server disconnected", request=httpx.Request("GET", "https://api.vworld.kr/req/address"))
    assert "api.vworld.kr 연결 실패" in http.explain_error(t)


def test_osm_parse():
    data = {"elements": [
        {"type": "node", "id": 1, "lat": 37.5, "lon": 127.0, "tags": {"railway": "station", "station": "subway", "name": "잠실역"}},
        {"type": "way", "id": 2, "center": {"lat": 37.51, "lon": 127.01}, "tags": {"amenity": "school", "name": "잠실초등학교"}},
        {"type": "node", "id": 3, "lat": 37.5, "lon": 127.0, "tags": {"highway": "bus_stop"}},
        {"type": "node", "id": 4, "lat": 37.5, "lon": 127.0, "tags": {"amenity": "bench"}},
        {"type": "node", "id": 5, "lat": 37.5, "lon": 127.0, "tags": {"shop": "convenience"}},  # 이름 없음 → 제외
    ]}
    rows = osm.parse(data)
    assert [(r["category"], r["subcategory"], r["source_id"]) for r in rows] == [
        ("subway", "subway", "node/1"), ("school", "초등학교", "way/2"), ("bus", None, "node/3")]


def test_ensure_item_geom(conn, monkeypatch):
    from myrealty_etl.transforms import geocode as g

    uid = conn.execute("insert into users (email) values ('g@example.com') returning id").fetchone()["id"]
    item = conn.execute(
        """insert into watch_items (user_id, property_type, label, jibun_address, lawd_cd)
           values (%s, 'forest', '임야', '충청북도 괴산군 연풍면 조령리 산 164-1', '4376035027') returning id::text as id""",
        (uid,),
    ).fetchone()["id"]
    # 예전에 실패로 캐시된 주소도 관심 부동산은 다시 시도한다
    conn.execute("insert into geocode_cache (query, lng, lat) values ('충청북도 괴산군 연풍면 조령리 산 164-1', null, null)")
    conn.commit()
    seen: list[str] = []

    def fake_naver(q):
        seen.append(q)
        return (128.0, 36.8) if q.endswith("산164-1") else None

    monkeypatch.setattr(g, "_naver", fake_naver)
    monkeypatch.setattr(g, "_vworld", lambda q: None)
    monkeypatch.setattr(g, "settings", replace(config.settings, ncp_key_id="id", ncp_key="k"))
    assert g.ensure_item_geom(conn, item) == "geocode"
    row = conn.execute("select ST_X(geom) as x from watch_items where id = %s", (item,)).fetchone()
    assert row["x"] == 128.0
    assert "충청북도 괴산군 연풍면 조령리 산164-1" in seen
    assert g.ensure_item_geom(conn, item) is None  # 이미 있음
