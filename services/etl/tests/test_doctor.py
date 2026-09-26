from types import SimpleNamespace

import httpx
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from myrealty_etl import doctor


def _b64(b: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _pair():
    k = ec.generate_private_key(ec.SECP256R1())
    pub = k.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return _b64(k.private_numbers().private_value.to_bytes(32, "big")), _b64(pub)


def test_fingerprints_hide_values():
    assert doctor.fingerprint("abc") == doctor.fingerprint("abc") != doctor.fingerprint("abd")
    assert doctor.fingerprint(None) is None and len(doctor.fingerprint("x")) == 8
    # 사용자·비밀번호가 달라도 같은 호스트/DB 면 같은 지문
    a = doctor.db_fingerprint("postgresql://u:p1@db.example.com:6543/postgres")
    b = doctor.db_fingerprint("postgresql://other:p2@DB.example.com:6543/postgres")
    assert a == b != doctor.db_fingerprint("postgresql://u:p@db.example.com:5432/postgres")


def test_sanitize_masks_secrets(monkeypatch):
    monkeypatch.setenv("DATA_GO_KR_KEY", "SECRETKEY123")
    assert "SECRETKEY123" not in doctor.sanitize("GET https://x?serviceKey=SECRETKEY123 failed")


def test_data_go_kr_error_mapping():
    assert "활용신청" in doctor._data_go_kr_error("RTMS 오류 20: SERVICE ACCESS DENIED").fix
    assert "Decoding" in doctor._data_go_kr_error("SERVICE_KEY_IS_NOT_REGISTERED_ERROR").fix


def test_vapid_pair(monkeypatch):
    priv, pub = _pair()
    _, other = _pair()
    monkeypatch.setattr(doctor, "settings", SimpleNamespace(vapid_public_key=pub, vapid_private_key=priv))
    assert doctor.check_vapid().status == "ok"
    monkeypatch.setattr(doctor, "settings", SimpleNamespace(vapid_public_key=other, vapid_private_key=priv))
    assert doctor.check_vapid().status == "error"
    monkeypatch.setattr(doctor, "settings", SimpleNamespace(vapid_public_key=None, vapid_private_key=priv))
    assert doctor.check_vapid().status == "error"


def test_cron_secret_cross_check(monkeypatch):
    monkeypatch.setenv("APP_URL", "https://app.example.com")
    monkeypatch.setenv("CRON_SECRET", "s3cret-value")

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/api/health":
            return httpx.Response(200, json={"ok": True})
        ok = req.headers.get("authorization") == "Bearer right-value"
        return httpx.Response(200 if ok else 401, json={})

    with httpx.Client(transport=httpx.MockTransport(handler)) as c:
        checks = {x.key: x for x in doctor.check_app(c)}
    assert checks["APP_URL"].status == "ok"
    assert checks["CRON_SECRET"].status == "error" and checks["CRON_SECRET"].fp == doctor.fingerprint("s3cret-value")


def test_markdown_has_no_values():
    md = doctor.to_markdown([doctor.Check("X_KEY", "x", "error", "a|b", "fix", "abcd1234")])
    assert "a\\|b" in md and "`abcd1234`" in md
