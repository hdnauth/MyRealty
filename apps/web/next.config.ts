import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

/**
 * 리포지토리 루트의 .env 하나로 웹·ETL 설정을 공유한다.
 * @next/env 의 loadEnvConfig 는 Next 가 먼저 apps/web 기준으로 부른 결과를 캐시해 두 번째 호출(루트)을 무시하므로
 * 직접 읽는다. 이미 설정된 환경 변수(배포 플랫폼 값·apps/web/.env*)는 덮어쓰지 않는다.
 */
function loadRootEnv(root: string) {
  for (const name of [".env.local", ".env"]) {
    let text: string;
    try {
      text = readFileSync(path.join(root, name), "utf8");
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(parseEnv(text))) {
      if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
    }
  }
}
loadRootEnv(path.resolve(__dirname, "../.."));

/**
 * db/migrations 목록은 빌드 시점에 읽어 번들에 넣는다. 런타임 readdir 은 Turbopack 이 프로젝트 전체를 추적하게 만들고
 * (경고), 서버리스 배포 번들에는 폴더가 없어 어차피 읽을 수 없다.
 */
function migrationFiles(root: string) {
  try {
    return readdirSync(path.join(root, "db/migrations")).filter((f) => f.endsWith(".sql")).sort().join(",");
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "nodemailer", "web-push"],
  poweredByHeader: false,
  devIndicators: false,
  env: { MIGRATION_FILES: migrationFiles(path.resolve(__dirname, "../..")) },
};

export default nextConfig;
