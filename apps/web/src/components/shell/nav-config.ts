// 메뉴 구성(사이드바·하단 탭·전체 메뉴가 함께 쓴다)
import {
  Bell,
  Bot,
  CalendarDays,
  Columns3,
  Construction,
  LayoutGrid,
  LineChart,
  Map as MapIcon,
  MessagesSquare,
  Sigma,
  Star,
  Wallet,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof MapIcon;
  /** 이 경로들 아래에 있으면 활성으로 본다(기본: href) */
  match?: string[];
  /** 이메일 가입이 필요한 기능(메뉴에 표시만) */
  member?: boolean;
  desc?: string;
};

/** 관심 탭: 관심 부동산이 있으면 요약 홈(/), 없으면 목록·등록 안내(/items) */
export const watchHref = (hasItems: boolean) => (hasItems ? "/" : "/items");

/** 하단 탭(모바일) */
export function bottomTabs(hasItems: boolean): NavItem[] {
  return [
    { href: "/map", label: "지도", icon: MapIcon },
    { href: watchHref(hasItems), label: "관심", icon: Star, match: ["/", "/items", "/portfolio", "/compare"] },
    { href: "/indicators", label: "시장", icon: LineChart, match: ["/indicators", "/projects"] },
    { href: "/community", label: "동네", icon: MessagesSquare },
    { href: "/menu", label: "전체", icon: LayoutGrid, match: ["/menu", "/settings", "/calendar", "/notifications", "/ai", "/admin"] },
  ];
}

/** 사이드바(PC)·전체 메뉴 묶음 */
export function navSections(hasItems: boolean): { title: string | null; items: NavItem[] }[] {
  return [
    {
      title: null,
      items: [
        { href: "/map", label: "지도", icon: MapIcon, desc: "단지별 시세·실거래" },
        { href: watchHref(hasItems), label: "관심 부동산", icon: Star, match: ["/", "/items"], desc: "내 부동산 요약·소식" },
        { href: "/community", label: "동네 이야기", icon: MessagesSquare, desc: "단지·지역 게시판" },
      ],
    },
    {
      title: "시장 분석",
      items: [
        { href: "/indicators", label: "시장 지표", icon: LineChart, match: ["/indicators"], desc: "가격지수·온도계·금리" },
        { href: "/projects", label: "개발·테마", icon: Construction, desc: "정비사업·교통 호재" },
        { href: "/indicators/custom", label: "커스텀 지표", icon: Sigma, desc: "나만의 지표 만들기" },
        { href: "/ai", label: "AI 질문", icon: Bot, member: true, desc: "내 데이터로 답하는 AI" },
      ],
    },
    {
      title: "내 자산",
      items: [
        { href: "/portfolio", label: "포트폴리오", icon: Wallet, desc: "보유 자산·대출" },
        { href: "/compare", label: "비교", icon: Columns3, desc: "최대 5개 나란히" },
        { href: "/calendar", label: "캘린더", icon: CalendarDays, desc: "청약·입주·세금 일정" },
        { href: "/notifications", label: "알림", icon: Bell, desc: "신고가·새 거래·뉴스" },
      ],
    },
  ];
}

export function isActive(path: string, item: Pick<NavItem, "href" | "match">, all?: Pick<NavItem, "href" | "match">[]) {
  const hit = (p: string) => (p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`));
  const own = (item.match ?? [item.href]).some(hit);
  if (!own || !all) return own;
  // 더 구체적인 메뉴가 있으면 그쪽만 활성(예: /indicators/custom 은 시장 지표가 아니라 커스텀 지표)
  const len = Math.max(...(item.match ?? [item.href]).filter(hit).map((p) => p.length));
  return !all.some((o) => o !== item && (o.match ?? [o.href]).some((p) => hit(p) && p.length > len));
}
