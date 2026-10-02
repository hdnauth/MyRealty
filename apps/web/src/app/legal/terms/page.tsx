import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/lib/env";
import { LEGAL_EFFECTIVE } from "@/lib/legal";

export const metadata: Metadata = { title: "이용약관" };

export default function TermsPage() {
  const contact = env.supportEmail ?? "(문의 이메일 미설정)";
  return (
    <>
      <h1>이용약관</h1>
      <p className="text-sm text-muted">시행일 {LEGAL_EFFECTIVE.terms}</p>

      <h2>1. 서비스</h2>
      <p>
        마이리얼티(MyRealty, 이하 &lsquo;서비스&rsquo;)는 공공데이터(실거래가·건축물대장·공시가격·경제지표 등), 지도, 뉴스와 AI 분석을 결합해 이용자가 등록한 관심 부동산을 중심으로
        시장 정보를 보여 주는 무료 서비스입니다. {env.operatorName}(이하 &lsquo;운영자&rsquo;)가 운영합니다.
      </p>

      <h2>2. 가입과 계정</h2>
      <ul>
        <li>이메일로 받은 로그인 코드를 입력하면 가입·로그인됩니다. 만 14세 이상만 가입할 수 있습니다.</li>
        <li>계정은 본인만 써야 하며, 다른 사람의 이메일로 가입하면 안 됩니다.</li>
        <li>설정 화면에서 언제든 탈퇴할 수 있습니다(<Link href="/legal/account-deletion">계정 삭제 안내</Link>).</li>
      </ul>

      <h2>3. 정보의 성격 — 투자 자문이 아닙니다</h2>
      <ul>
        <li>서비스의 시세 추정(AVM)·지표·보유세·대출 계산·AI 분석은 공공데이터에 기반한 <b>참고용 추정치</b>이며 감정평가·세무·법률·투자 자문이 아닙니다.</li>
        <li>공공데이터의 지연·누락·오류, AI의 잘못된 답변이 있을 수 있습니다. 중요한 결정 전에는 원자료와 전문가 의견을 확인하세요.</li>
        <li>운영자는 서비스 정보를 근거로 한 거래·투자 결과에 책임지지 않습니다. 다만 운영자의 고의·중대한 과실로 인한 손해는 예외입니다.</li>
      </ul>

      <h2>4. 동네 이야기(커뮤니티)</h2>
      <ul>
        <li>글·댓글을 쓰려면 닉네임을 정하고 <Link href="/community/rules">운영 원칙</Link>에 동의해야 합니다.</li>
        <li>
          집값 담합 유도, 광고·중개 홍보, 욕설·비방·혐오, 개인정보(동·호수·연락처 등) 노출, 허위 사실 유포, 불법 정보는 금지합니다. 이런 게시물은 자동 점검·AI 검토·이용자
          신고로 가려지거나 삭제될 수 있고, 반복하면 작성이 제한되거나 이용이 정지됩니다.
        </li>
        <li>부적절한 게시물은 &lsquo;신고&rsquo;로, 원하지 않는 이용자는 &lsquo;차단&rsquo;으로 대응할 수 있습니다. 신고는 운영자가 확인해 처리합니다.</li>
        <li>게시물의 권리와 책임은 작성자에게 있습니다. 운영자는 서비스 안에서 게시물을 보여 주고 요약(AI 포함)하는 데 필요한 범위에서 이용합니다.</li>
      </ul>

      <h2>5. AI 기능</h2>
      <ul>
        <li>AI 답변·리포트·요약은 자동 생성되며 틀릴 수 있습니다. 부적절하거나 잘못된 AI 답변은 &lsquo;AI 답변 신고&rsquo;로 알려 주세요.</li>
        <li>AI 사용에는 1인당 월 한도가 있을 수 있습니다. 본인 AI 키를 입력한 경우 해당 제공자의 약관과 요금이 적용됩니다.</li>
      </ul>

      <h2>6. 금지 행위</h2>
      <p>자동화 수단으로 데이터를 대량 수집하거나, 서비스·다른 이용자의 계정에 무단 접근하거나, 서비스 운영을 방해하는 행위를 금지합니다.</p>

      <h2>7. 서비스 변경·중단</h2>
      <p>운영자는 공공데이터 제공 중단, 시스템 점검 등으로 서비스의 전부 또는 일부를 바꾸거나 중단할 수 있으며, 가능한 경우 미리 공지합니다.</p>

      <h2>8. 문의</h2>
      <p>
        <a href={`mailto:${contact}`}>{contact}</a> · 개인정보 처리는 <Link href="/legal/privacy">개인정보처리방침</Link>을 따릅니다.
      </p>
    </>
  );
}
