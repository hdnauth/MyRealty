#!/usr/bin/env bash
# Google Play 업로드 키 만들기(한 번만). 키 파일은 리포 밖에 두고 백업한다.
# Play 앱 서명을 쓰므로 이 키를 잃어버려도 Play Console 에서 업로드 키 재설정을 요청할 수 있다.
#   사용: apps/android/scripts/create-upload-key.sh [키 파일 경로]
# 필요: JDK 17+ (brew install openjdk@21)
set -euo pipefail

KEYSTORE="${1:-$HOME/.android-keys/myrealty-upload.jks}"
ALIAS=upload

# macOS 의 /usr/bin/keytool 은 JDK 가 없으면 동작하지 않는 껍데기라 실제 JDK 를 먼저 찾는다
KEYTOOL=""
for k in "${JAVA_HOME:-}/bin/keytool" /opt/homebrew/opt/openjdk@21/bin/keytool /opt/homebrew/opt/openjdk/bin/keytool \
         "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" keytool; do
  if [[ -n "$k" ]] && "$k" -help >/dev/null 2>&1; then KEYTOOL="$k"; break; fi
done
[[ -n "$KEYTOOL" ]] || { echo "JDK 가 없습니다. 먼저 설치하세요: brew install openjdk@21" >&2; exit 1; }

if [[ -e "$KEYSTORE" ]]; then
  echo "이미 있습니다: $KEYSTORE (덮어쓰지 않음)" >&2
  exit 1
fi

mkdir -p "$(dirname "$KEYSTORE")"
chmod 700 "$(dirname "$KEYSTORE")"
read -r -s -p "키 비밀번호를 정하세요(6자 이상, 비밀번호 관리자에 꼭 적어 두기): " MR_KEY_PASS; echo
read -r -s -p "한 번 더 입력: " MR_KEY_PASS2; echo
[[ "$MR_KEY_PASS" == "$MR_KEY_PASS2" ]] || { echo "두 비밀번호가 다릅니다." >&2; exit 1; }
[[ ${#MR_KEY_PASS} -ge 6 ]] || { echo "6자 이상이어야 합니다." >&2; exit 1; }
export MR_KEY_PASS
"$KEYTOOL" -genkeypair -noprompt \
  -keystore "$KEYSTORE" -alias "$ALIAS" \
  -storepass:env MR_KEY_PASS -keypass:env MR_KEY_PASS \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=MyRealty, O=MyRealty, C=KR"
chmod 600 "$KEYSTORE"

B64="${KEYSTORE%.*}.base64.txt"
openssl base64 -A -in "$KEYSTORE" -out "$B64"
chmod 600 "$B64"

echo
echo "만들었습니다: $KEYSTORE  ← 이 파일과 비밀번호를 함께 백업하세요"
echo
echo "[1] Vercel 환경 변수 ANDROID_CERT_SHA256 에 넣을 값(업로드 키 지문):"
echo "    $("$KEYTOOL" -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass:env MR_KEY_PASS | awk '/SHA256:/ {print $2}')"
echo
echo "[2] GitHub Secrets"
echo "    ANDROID_KEYSTORE_BASE64  = $B64 파일 내용 전체 (VS Code 로 열어 복사, 등록 후 이 파일은 지우기)"
echo "    ANDROID_KEYSTORE_PASSWORD = 방금 정한 비밀번호"
