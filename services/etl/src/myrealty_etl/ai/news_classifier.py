"""뉴스 ↔ 관심 물건 관련도 분류 (Claude, 구조화 출력).

- 건수가 적으면 동기 호출, 많으면 Message Batches API(50% 비용)로 제출하고 다음 실행 때 결과를 반영한다.
- 링크 상태: pending → queued(배치 제출) → classified | error
"""

from __future__ import annotations

import json
import logging

from ..config import settings
from . import client as ai

log = logging.getLogger(__name__)

CATEGORIES = ["재건축", "재개발", "교통", "개발", "규제", "대출", "세금", "공급", "학군", "시장동향", "사건사고", "광고", "기타"]

SYSTEM = f"""당신은 한국 부동산 뉴스 분석가입니다. 주어진 관심 부동산(물건) 정보와 기사 1건을 보고, 이 기사가 해당 물건의 소유자·매수 검토자에게 얼마나 관련 있는지 판단합니다.

판단 기준:
- relevance(0~1): 1에 가까울수록 이 물건(단지·필지)이나 바로 인접 지역을 직접 다룸. 같은 시군구 일반 시장 기사는 0.4~0.6, 전국 단위 정책(대출·세제·규제)은 0.4~0.7, 이름만 같은 다른 지역·무관 기사는 0.1 이하.
- 분양 홍보성 기사(광고)는 category=광고, relevance 0.3 이하. 단, 물건 반경 수 km 내 대규모 공급이면 category=공급으로 0.5 이상.
- impact(-2~+2): 이 물건 가치에 대한 영향. 호재 +, 악재 -, 중립 0. 확정되지 않은 계획은 한 단계 약하게.
- category: {", ".join(CATEGORIES)} 중 하나.
- summary: 물건 관점에서 핵심을 한국어 한 문장(80자 이내)으로. 기사에 없는 사실을 추측하지 말 것.
- affected_regions: 기사에서 영향받는 지역명(법정동·시군구·역명 등), 없으면 빈 배열."""

SCHEMA = {
    "type": "object",
    "properties": {
        "relevance": {"type": "number"},
        "category": {"type": "string", "enum": CATEGORIES},
        "impact": {"type": "integer", "enum": [-2, -1, 0, 1, 2]},
        "summary": {"type": "string"},
        "affected_regions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["relevance", "category", "impact", "summary", "affected_regions"],
    "additionalProperties": False,
}


def build_params(model: str, item: dict, article: dict) -> dict:
    ctx = {
        "유형": item["property_type"],
        "이름": item.get("building_name") or item["label"],
        "주소": item.get("road_address") or item.get("jibun_address"),
        "키워드": item.get("keywords") or [],
    }
    user = (
        f"[관심 물건]\n{json.dumps(ctx, ensure_ascii=False)}\n\n"
        f"[기사]\n제목: {article['title']}\n요약: {article.get('description') or ''}\n"
        f"언론사: {article.get('source') or ''}\n발행: {article.get('published_at') or ''}"
    )
    output_config: dict = {"format": {"type": "json_schema", "schema": SCHEMA}}
    if ai.supports_effort(model):
        output_config["effort"] = "low"
    return {
        "model": model,
        "max_tokens": 2048,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": user}],
        "output_config": output_config,
    }


def parse_result(message) -> dict:
    if message.stop_reason == "refusal":
        raise ValueError("refusal")
    if message.stop_reason == "max_tokens":
        raise ValueError("max_tokens")
    data = json.loads(ai.first_text(message))
    data["relevance"] = max(0.0, min(1.0, float(data["relevance"])))
    data["impact"] = max(-2, min(2, int(data["impact"])))
    data["summary"] = data["summary"][:200]
    return data


def apply(conn, link_id: int, data: dict | None, error: str | None = None) -> None:
    if data is None:
        conn.execute("update article_links set status = 'error', classified_at = now() where id = %s", (link_id,))
        log.warning("분류 실패 link=%s: %s", link_id, error)
        return
    conn.execute(
        """update article_links set status = 'classified', relevance = %s, category = %s, impact = %s,
             ai_summary = %s, classified_at = now() where id = %s""",
        (data["relevance"], data["category"], data["impact"], data["summary"], link_id),
    )


PENDING_SQL = """
select l.id as link_id, a.title, a.description, a.source, a.published_at::text as published_at,
       w.property_type, w.label, w.building_name, w.road_address, w.jibun_address, w.keywords
from article_links l join articles a on a.id = l.article_id join watch_items w on w.id = l.watch_item_id
where l.status = 'pending' and a.published_at > now() - interval '30 days'
order by a.published_at desc
limit %s
"""


def poll_batches(conn, cl) -> dict:
    stats = {"applied": 0, "batches": 0}
    for b in conn.execute("select * from ai_batches where status = 'in_progress' and purpose = 'news_classify'").fetchall():
        batch = cl.messages.batches.retrieve(b["batch_id"])
        if batch.processing_status != "ended":
            continue
        model = settings.anthropic_bulk_model
        for res in cl.messages.batches.results(b["batch_id"]):
            link_id = int(res.custom_id.removeprefix("link-"))
            if res.result.type == "succeeded":
                msg = res.result.message
                ai.record_usage(conn, "news_classify", msg.model or model, msg.usage, batch=True)
                try:
                    apply(conn, link_id, parse_result(msg))
                    stats["applied"] += 1
                except (ValueError, KeyError, json.JSONDecodeError) as e:
                    apply(conn, link_id, None, repr(e))
            elif res.result.type in ("expired", "canceled"):
                conn.execute("update article_links set status = 'pending' where id = %s", (link_id,))
            else:
                apply(conn, link_id, None, res.result.type)
        conn.execute("update ai_batches set status = 'applied', applied_at = now() where id = %s", (b["id"],))
        conn.commit()
        stats["batches"] += 1
    return stats


def classify_pending(conn, *, mode: str = "auto", limit: int = 500, sync_threshold: int = 15) -> dict:
    cl = ai.get_client()
    if cl is None:
        return {"skipped": "ANTHROPIC_API_KEY 미설정"}
    stats = {"polled": poll_batches(conn, cl)}
    if ai.budget_left(conn) <= 0:
        stats["skipped"] = "월 AI 예산 초과"
        return stats
    rows = conn.execute(PENDING_SQL, (limit,)).fetchall()
    stats["pending"] = len(rows)
    if not rows:
        return stats
    model = settings.anthropic_bulk_model
    if mode == "sync" or (mode == "auto" and len(rows) <= sync_threshold):
        import anthropic

        done = 0
        for r in rows:
            try:
                msg = cl.messages.create(**build_params(model, r, r))
                ai.record_usage(conn, "news_classify", model, msg.usage)
                apply(conn, r["link_id"], parse_result(msg))
                done += 1
            except (ValueError, KeyError, json.JSONDecodeError) as e:
                apply(conn, r["link_id"], None, repr(e))
            except anthropic.RateLimitError:
                log.warning("레이트 리밋 — 남은 건은 다음 실행에서")
                break
            conn.commit()
        stats["classified_sync"] = done
        return stats

    requests = [{"custom_id": f"link-{r['link_id']}", "params": build_params(model, r, r)} for r in rows]
    batch = cl.messages.batches.create(requests=requests)
    ids = [r["link_id"] for r in rows]
    conn.execute(
        "insert into ai_batches (purpose, batch_id, request_ids) values ('news_classify', %s, %s)",
        (batch.id, [str(i) for i in ids]),
    )
    conn.execute("update article_links set status = 'queued' where id = any(%s)", (ids,))
    conn.commit()
    stats["batch_submitted"] = {"id": batch.id, "count": len(ids)}
    return stats

