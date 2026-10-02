"""개인정보 보관 기간 정리: 로그인 코드 기록(이메일·IP)과 끝난 세션(기기 정보)은 30일, 처리한 AI 답변 신고는 1년 뒤 지운다.
개인정보처리방침(/legal/privacy)의 보관 기간과 맞춰야 한다."""

RETENTION_DAYS = 30


def cleanup_auth(conn) -> dict:
    otp = conn.execute(
        "delete from otp_codes where created_at < now() - make_interval(days => %s)", (RETENTION_DAYS,)
    ).rowcount
    sessions = conn.execute(
        """delete from sessions
           where (revoked_at is not null and revoked_at < now() - make_interval(days => %s))
              or expires_at < now() - make_interval(days => %s)""",
        (RETENTION_DAYS, RETENTION_DAYS),
    ).rowcount
    ai_feedback = conn.execute(
        "delete from ai_feedback where status = 'resolved' and resolved_at < now() - interval '1 year'"
    ).rowcount
    conn.commit()
    return {"otp_codes": otp, "sessions": sessions, "ai_feedback": ai_feedback}
