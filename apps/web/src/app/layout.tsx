import type { Metadata, Viewport } from "next";
import "./globals.css";
import { THEME_BG, THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: { default: "마이리얼티", template: "%s · 마이리얼티" },
  description: "나만을 위한 부동산 인텔리전스",
  appleWebApp: { capable: true, title: "마이리얼티", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_BG.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_BG.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme 은 첫 페인트 전 스크립트가 붙인다(설정 › 화면 테마) — 서버 HTML 과 달라도 경고하지 않게
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
