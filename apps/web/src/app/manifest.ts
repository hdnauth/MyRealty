import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "마이리얼티 — 나만의 부동산 인텔리전스",
    short_name: "마이리얼티",
    description: "관심 부동산의 실거래·주변 시세·뉴스·지표를 한 곳에서",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#2563eb",
    lang: "ko",
    categories: ["finance", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "지도", url: "/map", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "관심 부동산", url: "/items", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "AI 질문하기", url: "/ai", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
