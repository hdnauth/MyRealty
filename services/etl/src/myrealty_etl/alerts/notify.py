"""알림 전달: 중요 알림은 웹푸시로 즉시, 나머지는 하루 1회 이메일 다이제스트."""

from __future__ import annotations

import html
import json
import logging
import smtplib
from email.message import EmailMessage

from ..config import settings

log = logging.getLogger(__name__)


def send_push(conn, min_priority: int = 2) -> dict:
    if not (settings.vapid_private_key and settings.vapid_public_key):
        return {"skipped": "VAPID 키 미설정"}
    from pywebpush import WebPushException, webpush

    rows = conn.execute(
        """select n.id, n.user_id, n.title, n.body, n.url, n.kind from notifications n
           where n.pushed_at is null and n.priority >= %s and n.created_at > now() - interval '2 days'
             and exists (select 1 from users u where u.id = n.user_id and u.status = 'active'
                         and coalesce((u.settings->>'pushEnabled')::boolean, true))
           order by n.created_at""",
        (min_priority,),
    ).fetchall()
    sent = gone = 0
    for n in rows:
        subs = conn.execute("select endpoint, keys from push_subscriptions where user_id = %s", (n["user_id"],)).fetchall()
        for s in subs:
            try:
                webpush(
                    subscription_info={"endpoint": s["endpoint"], "keys": s["keys"]},
                    data=json.dumps({"title": n["title"], "body": n["body"] or "", "url": n["url"] or "/notifications",
                                     "tag": f"n{n['id']}"}, ensure_ascii=False),
                    vapid_private_key=settings.vapid_private_key,
                    vapid_claims={"sub": settings.vapid_subject},
                    ttl=86400,
                )
                sent += 1
            except WebPushException as e:
                status = getattr(e.response, "status_code", None)
                if status in (404, 410):  # 만료된 구독
                    conn.execute("delete from push_subscriptions where endpoint = %s", (s["endpoint"],))
                    gone += 1
                else:
                    log.warning("푸시 실패: %s", e)
        conn.execute("update notifications set pushed_at = now() where id = %s", (n["id"],))
    conn.commit()
    return {"sent": sent, "expired_subscriptions": gone, "notifications": len(rows)}


KIND_LABEL = {
    "record_high": "신고가", "record_low": "저가", "new_trade": "실거래", "canceled": "해제", "news": "뉴스",
    "subscription": "청약", "lease_expiry": "만기", "calendar": "일정", "indicator": "지표", "rate": "금리", "policy": "정책",
    "community_reply": "댓글", "community_hot": "동네 이야기", "community_mod": "운영",
}


def render_digest(user_email: str, rows: list[dict]) -> tuple[str, str, str]:
    subject = f"[마이리얼티] 오늘의 부동산 소식 {len(rows)}건"
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["item_label"] or "공통", []).append(r)
    text_lines, html_parts = [], []
    for label, items in groups.items():
        text_lines.append(f"■ {label}")
        lis = []
        for r in items:
            tag = KIND_LABEL.get(r["kind"], r["kind"])
            link = r["url"] if (r["url"] or "").startswith("http") else f"{settings.app_url}{r['url'] or '/notifications'}"
            text_lines.append(f"  - [{tag}] {r['title']}" + (f" — {r['body']}" if r["body"] else ""))
            lis.append(
                f'<li style="margin:6px 0"><b>[{html.escape(tag)}]</b> <a href="{html.escape(link)}">{html.escape(r["title"])}</a>'
                + (f'<br><span style="color:#6b7280">{html.escape(r["body"])}</span>' if r["body"] else "") + "</li>"
            )
        html_parts.append(f'<h3 style="margin:16px 0 4px">{html.escape(label)}</h3><ul style="padding-left:18px">{"".join(lis)}</ul>')
    text = "\n".join(text_lines) + f"\n\n전체 보기: {settings.app_url}/notifications"
    body = (f'<div style="font-family:sans-serif;font-size:14px;line-height:1.5">{"".join(html_parts)}'
            f'<p><a href="{settings.app_url}/notifications">앱에서 전체 보기</a></p></div>')
    return subject, text, body


def send_mail(to: str, subject: str, text: str, html_body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.mail_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as s:
        if settings.smtp_port != 25:
            s.starttls()
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password or "")
        s.send_message(msg)


def send_digest(conn) -> dict:
    if not settings.smtp_host:
        return {"skipped": "SMTP_HOST 미설정"}
    users = conn.execute(
        # 기기 게스트(이메일 없음)는 웹푸시로만 받는다
        """select id, email from users
           where status = 'active' and email is not null and coalesce((settings->>'emailDigest')::boolean, true)"""
    ).fetchall()
    sent = 0
    for u in users:
        rows = conn.execute(
            """select n.id, n.kind, n.title, n.body, n.url, w.label as item_label from notifications n
               left join watch_items w on w.id = n.watch_item_id
               where n.user_id = %s and n.emailed_at is null and n.read_at is null
                 and n.created_at > now() - interval '3 days'
               order by n.priority desc, n.created_at desc limit 50""",
            (u["id"],),
        ).fetchall()
        if not rows:
            continue
        subject, text, body = render_digest(u["email"], rows)
        send_mail(u["email"], subject, text, body)
        conn.execute("update notifications set emailed_at = now() where id = any(%s)", ([r["id"] for r in rows],))
        conn.commit()
        sent += 1
    return {"emails": sent}
