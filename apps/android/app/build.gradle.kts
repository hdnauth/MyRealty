// MyRealty Android 앱: 웹앱(PWA)을 Trusted Web Activity(TWA)로 전체 화면에 띄운다.
// 화면·기능은 모두 웹에 있으므로 웹을 배포하면 앱에도 바로 반영된다. 이 프로젝트는 껍데기(아이콘·스플래시·도메인 인증·알림 위임)만 담당한다.
plugins {
    id("com.android.application")
}

fun prop(name: String) = providers.gradleProperty(name).get()

val twaHost = prop("twa.host")
val launchUrl = "https://$twaHost${prop("twa.launchPath")}"

android {
    namespace = "com.yarch.myrealty"
    compileSdk = 36

    defaultConfig {
        applicationId = prop("twa.applicationId")
        minSdk = 24
        targetSdk = 36
        versionCode = prop("twa.versionCode").toInt()
        versionName = prop("twa.versionName")

        manifestPlaceholders["hostName"] = twaHost
        resValue("string", "launchUrl", launchUrl)
        resValue("string", "providerAuthority", "${prop("twa.applicationId")}.fileprovider")
        // 앱 → 웹 방향 인증. 웹 → 앱 방향은 https://<host>/.well-known/assetlinks.json (웹의 ANDROID_CERT_SHA256)
        // 문자열 리소스는 따옴표를 지우므로 \" 로 이스케이프한다
        resValue(
            "string",
            "assetStatements",
            """[{\"relation\":[\"delegate_permission/common.handle_all_urls\"],\"target\":{\"namespace\":\"web\",\"site\":\"https://$twaHost\"}}]""",
        )
    }

    buildFeatures {
        resValues = true
    }

    // 업로드 키: 환경 변수가 있을 때만 서명한다(로컬은 scripts/create-upload-key.sh, CI 는 GitHub Secrets)
    val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
    signingConfigs {
        if (keystorePath != null) {
            create("upload") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "upload"
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // 앱 코드가 라이브러리뿐이라 축소할 것이 거의 없다
            isMinifyEnabled = false
            if (keystorePath != null) signingConfig = signingConfigs.getByName("upload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.3")
}
