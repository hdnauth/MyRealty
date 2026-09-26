import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// 리포지토리 루트의 .env 하나로 웹·ETL 설정을 공유한다.
loadEnvConfig(path.resolve(__dirname, "../.."));

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "nodemailer", "web-push"],
  poweredByHeader: false,
};

export default nextConfig;
