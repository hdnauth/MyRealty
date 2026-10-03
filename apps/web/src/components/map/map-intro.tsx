"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "myrealty.mapIntro.dismissed";

/**
 * 처음 온 사람(관심 부동산 없음)에게 지도 목록 위에서, 단지를 누르거나 주소를 등록하면 무엇을 볼 수 있는지 보여 준다.
 * 닫으면 이 기기에서 다시 안 보인다.
 */
export function MapIntro() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      // 마운트 뒤 이 기기의 닫힘 기록을 읽는다(서버 렌더와 맞추려고 처음엔 숨김)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShow(localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  };
  return (
    <div className="relative border-b border-border bg-surface-2/60 p-4">
      <button type="button" onClick={close} aria-label="안내 닫기" className="absolute right-2 top-2 p-1 text-muted hover:text-text">
        <X size={16} />
      </button>
      <p className="pr-6 text-sm font-semibold leading-snug">단지를 누르면 시세와 함께 이런 것까지 보여 드려요</p>
      <ul className="mt-2 space-y-1 text-xs text-muted">
        <li>· 비슷한 단지 대비 가격 위치 — 평소 격차와 비교</li>
        <li>· 층별 가격 차이, 신규·갱신 전세 차이, 등기 안 된 신고가 비율</li>
        <li>· 금리·거래·공급으로 본 시장 판정과 그 판정의 과거 적중률</li>
        <li>· 필요한 대출·월 상환, 깡통전세·역전세 점검</li>
      </ul>
      <div className="mt-3 flex items-center gap-3 text-xs">
        <Link href="/items/new" className="rounded-lg bg-accent px-3 py-2 font-medium text-white">관심 부동산 등록</Link>
        <span className="text-muted">로그인 없이 바로 쓸 수 있어요</span>
      </div>
    </div>
  );
}
