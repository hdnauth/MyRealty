import { env } from "@/lib/env";

/**
 * Digital Asset Links: Android 앱(TWA)이 이 도메인을 주소창 없이 전체 화면으로 열 수 있게 한다.
 * ANDROID_CERT_SHA256 에 업로드 키와 Play 앱 서명 키 지문을 모두 넣는다(Play Console → 앱 무결성 → 앱 서명).
 * 지문이 없으면 빈 배열 — 앱은 주소창이 보이는 Custom Tab 으로 열린다.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const body = env.androidCertFingerprints.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: { namespace: "android_app", package_name: env.androidPackage, sha256_cert_fingerprints: env.androidCertFingerprints },
        },
      ]
    : [];
  return Response.json(body, { headers: { "cache-control": "public, max-age=3600" } });
}
