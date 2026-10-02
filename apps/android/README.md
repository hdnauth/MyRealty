# MyRealty Android (TWA)

웹앱을 Trusted Web Activity 로 띄우는 Android 껍데기. 출시 절차·스토어 답변은 [docs/12-android-app.md](../../docs/12-android-app.md).

```
gradle.properties          패키지명·도메인·버전 (twa.*) — ISO-8859-1 로 읽히므로 한글을 넣지 않는다
app/build.gradle.kts       AGP 9, compile/target SDK 36, androidbrowserhelper 2.7
app/src/main/AndroidManifest.xml   LauncherActivity(TWA) · 알림 위임 · 도메인 링크
app/src/main/res/values/strings.xml   앱 이름(마이리얼티)
app/src/main/res/          아이콘(웹 icons 에서 생성) · 스플래시 · 알림 아이콘 · 색상(웹 theme 과 같게)
scripts/create-upload-key.sh       업로드 키 만들기(한 번)
store/                     스토어 아이콘(512)·그래픽 이미지(1024×500)
```

## 빌드

JDK 17+ 와 Android SDK(Android Studio 또는 command-line tools)가 필요하다. `ANDROID_HOME` 을 설정하거나 `local.properties` 에 `sdk.dir=` 을 넣는다.

```bash
./gradlew assembleDebug          # 기기 확인용 APK (app/build/outputs/apk/debug/)
./gradlew lintRelease bundleRelease   # 서명 없는 .aab — 구성 확인용

# 서명된 .aab (Play 업로드용)
ANDROID_KEYSTORE_PATH=~/.android-keys/myrealty-upload.jks \
ANDROID_KEYSTORE_PASSWORD=... \
./gradlew bundleRelease -Ptwa.versionCode=2
```

보통은 GitHub Actions **Android** 를 수동 실행해 서명된 `.aab` 를 받는다(시크릿 `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`).

## 아이콘을 바꿀 때

웹 `apps/web/public/icons/` 를 바꾼 뒤 다시 만든다(macOS `sips`).

```bash
W=../web/public/icons; R=app/src/main/res
for d in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read n l f <<< "$d"
  sips -s format png -z $l $l $W/icon-512.png --out $R/mipmap-$n/ic_launcher.png
  sips -s format png -z $f $f $W/icon-512-maskable.png --out $R/mipmap-$n/ic_launcher_foreground.png
done
sips -s format png -z 384 384 $W/icon-512.png --out $R/drawable-nodpi/splash.png
```

알림·테마 아이콘(`drawable/ic_notification_icon.xml`)은 단색 벡터라 따로 고친다.

## 주소창이 보일 때

도메인 인증 실패다. `https://<도메인>/.well-known/assetlinks.json` 에 **설치한 앱을 서명한 키**의 SHA-256 이 있는지 본다
(Play 에서 받은 앱 = Play 앱 서명 키, 직접 설치한 릴리스 = 업로드 키, 디버그 = `~/.android/debug.keystore`). 웹 환경 변수 `ANDROID_CERT_SHA256` 에 쉼표로 넣고 재배포.
기기에서는 `adb shell pm get-app-links com.yarch.myrealty` 로 확인한다.
