"""환경 변수 기반 설정. 키가 없는 수집기는 건너뛴다(로그로 알림)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv() -> None:
    """리포지토리 루트 또는 현재 경로의 .env 를 (이미 설정된 값은 덮어쓰지 않고) 읽는다."""
    here = Path.cwd()
    for base in (here, *here.parents):
        env = base / ".env"
        if env.is_file():
            for line in env.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            return


_load_dotenv()


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is not None:
        # 붙여 넣을 때 섞인 공백·줄바꿈·따옴표 제거
        v = v.strip().strip('"').strip("'").strip()
    return v if v not in (None, "") else default


def _service_key(name: str) -> str | None:
    """공공데이터포털 키: Encoding 키(%2B·%3D 포함)를 넣었으면 Decoding 키로 바꾼다(요청 때 다시 인코딩되므로)."""
    v = _env(name)
    if v and "%" in v:
        from urllib.parse import unquote

        v = unquote(v)
    return v


def _app_url(v: str | None) -> str:
    """APP_URL 에 https:// 가 빠져 있으면 붙인다(예: myrealty.vercel.app)."""
    v = (v or "http://localhost:3000").rstrip("/")
    return v if "://" in v else f"https://{v}"


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL", "postgresql://myrealty:myrealty@localhost:5432/myrealty"))
    # 공공데이터포털(data.go.kr) 일반 인증키(Decoding 키)
    data_go_kr_key: str | None = field(default_factory=lambda: _service_key("DATA_GO_KR_KEY"))
    vworld_key: str | None = field(default_factory=lambda: _env("VWORLD_KEY"))
    vworld_domain: str | None = field(default_factory=lambda: _env("VWORLD_DOMAIN"))
    ecos_key: str | None = field(default_factory=lambda: _env("ECOS_KEY"))
    kosis_key: str | None = field(default_factory=lambda: _env("KOSIS_KEY"))
    reb_key: str | None = field(default_factory=lambda: _env("REB_KEY"))
    naver_client_id: str | None = field(default_factory=lambda: _env("NAVER_CLIENT_ID"))
    naver_client_secret: str | None = field(default_factory=lambda: _env("NAVER_CLIENT_SECRET"))
    ncp_key_id: str | None = field(default_factory=lambda: _env("NCP_MAPS_KEY_ID"))
    ncp_key: str | None = field(default_factory=lambda: _env("NCP_MAPS_KEY"))
    anthropic_api_key: str | None = field(default_factory=lambda: _env("ANTHROPIC_API_KEY"))
    anthropic_model: str = field(default_factory=lambda: _env("ANTHROPIC_MODEL", "claude-opus-5"))
    anthropic_bulk_model: str = field(default_factory=lambda: _env("ANTHROPIC_BULK_MODEL", "claude-opus-5"))
    ai_monthly_budget_usd: float = field(default_factory=lambda: float(_env("AI_MONTHLY_BUDGET_USD", "30")))
    smtp_host: str | None = field(default_factory=lambda: _env("SMTP_HOST"))
    smtp_port: int = field(default_factory=lambda: int(_env("SMTP_PORT", "587")))
    smtp_user: str | None = field(default_factory=lambda: _env("SMTP_USER"))
    smtp_password: str | None = field(default_factory=lambda: _env("SMTP_PASSWORD"))
    mail_from: str = field(default_factory=lambda: _env("MAIL_FROM", "MyRealty <no-reply@example.com>"))
    app_url: str = field(default_factory=lambda: _app_url(_env("APP_URL")))
    # 웹(Vercel, 서울 리전)을 거쳐 국내 API 를 부르는 중계(/api/relay) 인증. 웹과 같은 값
    cron_secret: str | None = field(default_factory=lambda: _env("CRON_SECRET"))
    # 국내 API 중계: auto(직접 호출이 거부·차단되면 웹을 거침) | always | off
    kr_relay: str = field(default_factory=lambda: (_env("KR_RELAY", "auto") or "auto").lower())
    vapid_public_key: str | None = field(default_factory=lambda: _env("NEXT_PUBLIC_VAPID_PUBLIC_KEY"))
    vapid_private_key: str | None = field(default_factory=lambda: _env("VAPID_PRIVATE_KEY"))
    vapid_subject: str = field(default_factory=lambda: _env("VAPID_SUBJECT", "mailto:admin@example.com"))
    # 일일 호출 한도(개발계정 기본값). 운영계정 전환 시 늘린다.
    daily_quota_data_go_kr: int = field(default_factory=lambda: int(_env("QUOTA_DATA_GO_KR", "900")))
    # 매일 파이프라인 수집 단계의 시간 예산(분). 지나면 남은 수집 단계는 다음 실행으로 넘긴다(알림 단계는 항상 실행). 비우면 무제한
    daily_budget_min: float | None = field(default_factory=lambda: float(v) if (v := _env("DAILY_BUDGET_MIN")) else None)


settings = Settings()
