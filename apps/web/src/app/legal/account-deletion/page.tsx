import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "계정 삭제" };

/** Google Play 데이터 삭제 정책: 앱 밖에서도 계정 삭제를 요청할 수 있는 공개 URL */
export default function AccountDeletionPage() {
  const contact = env.supportEmail ?? "(문의 이메일 미설정)";
  const subject = encodeURIComponent("[마이리얼티] 계정 삭제 요청");
  const body = encodeURIComponent("가입한 이메일 주소: \n(이 메일을 가입한 이메일 주소에서 보내 주세요)");
  return (
    <>
      <h1>마이리얼티 계정 삭제</h1>
      <p>마이리얼티(웹·Android 앱) 계정과 데이터를 삭제하는 방법입니다.</p>

      <h2>앱에서 바로 삭제</h2>
      <ol>
        <li>로그인 후 <Link href="/settings">설정</Link>으로 이동합니다(모바일은 메뉴 → 설정).</li>
        <li>맨 아래 <b>회원 탈퇴</b>에 가입한 이메일 주소를 입력하고 <b>탈퇴</b>를 누릅니다.</li>
        <li>즉시 삭제되며 되돌릴 수 없습니다.</li>
      </ol>

      <h2>앱에 들어갈 수 없을 때</h2>
      <p>
        가입한 이메일 주소에서 <a href={`mailto:${contact}?subject=${subject}&body=${body}`}>{contact}</a>로 &ldquo;계정 삭제 요청&rdquo; 메일을 보내 주세요. 본인 확인 후
        10일 이내에 삭제하고 결과를 회신합니다.
      </p>

      <h2>삭제되는 데이터</h2>
      <ul>
        <li>계정(이메일·닉네임), 로그인된 기기·세션</li>
        <li>관심 부동산과 매입·대출·임대 정보, 메모, 체크리스트, 커스텀 지표</li>
        <li>알림 기록·알림 설정·웹푸시 구독</li>
        <li>AI 대화·리포트·분석 카드, 직접 입력한 AI 키</li>
        <li>동네 이야기 첨부 사진, 좋아요·투표·구독·차단 목록, 거주 인증 기록</li>
      </ul>

      <h2>남는 데이터</h2>
      <ul>
        <li>
          동네 이야기에 쓴 <b>글·댓글</b>은 다른 이용자의 대화 맥락을 위해 남되, 작성자 정보와 분리되어 &lsquo;탈퇴한 사용자&rsquo;로 표시됩니다. 지우려면 탈퇴 전에 직접
          삭제하세요.
        </li>
        <li>로그인 코드 요청 기록(이메일·IP)은 부정 이용 확인을 위해 요청일로부터 30일까지 남았다가 자동 삭제됩니다.</li>
        <li>데이터베이스 백업에는 최대 7일까지 남을 수 있습니다.</li>
      </ul>
      <p>
        계정을 지우지 않고 일부 데이터만 지우려면 앱에서 해당 항목(관심 부동산, AI 대화, 글·댓글 등)을 직접 삭제하거나 위 이메일로 요청하세요. 자세한 내용은{" "}
        <Link href="/legal/privacy">개인정보처리방침</Link>을 보세요.
      </p>
    </>
  );
}
