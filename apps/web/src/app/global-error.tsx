"use client";

// 루트 레이아웃까지 실패했을 때. 전역 CSS 가 없으므로 인라인 스타일만 쓴다.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0, padding: 16 }}>
        <title>오류 · 마이리얼티</title>
        <div style={{ maxWidth: 380, textAlign: "center" }}>
          <h1 style={{ fontSize: 18 }}>페이지를 불러오지 못했습니다</h1>
          <p style={{ fontSize: 14, color: "#6b7280" }}>
            서버 오류가 발생했습니다. 잠시 후 다시 시도하세요. 계속되면 관리자에게 아래 오류 번호를 알려 주세요.
          </p>
          {error.digest ? <p style={{ fontFamily: "monospace", fontSize: 12, color: "#6b7280" }}>오류 번호 {error.digest}</p> : null}
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: 12, height: 40, padding: "0 16px", borderRadius: 8, border: 0, background: "#2563eb", color: "#fff", fontSize: 14 }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
