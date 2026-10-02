"use client";

import { MapPin } from "lucide-react";
import { useActionState, useState } from "react";
import { type FormState, saveProfileAction } from "@/app/(main)/community/actions";
import { Button, Field, Input } from "@/components/ui";

export function ProfileForm({ nickname, agreed, showOwner, push, next }: { nickname: string | null; agreed: boolean; showOwner: boolean; push: boolean; next: string | null }) {
  const [state, action, pending] = useActionState(saveProfileAction, {} as FormState);
  return (
    <form action={action} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="닉네임" hint="2~12자, 한글·영문·숫자·밑줄. 앱 전체에서 같은 이름으로 보이고, 바꾼 뒤 30일 동안은 다시 바꿀 수 없습니다.">
        <Input name="nickname" defaultValue={nickname ?? ""} required minLength={2} maxLength={12} placeholder="예) 잠실새내기" autoComplete="off" />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="show_owner" defaultChecked={showOwner} className="mt-1" />
        <span>
          <b>보유 배지 표시</b> — 보유로 등록한 단지(지역) 게시판에서 내 글에 &lsquo;보유&rsquo;를 표시합니다.
          <span className="block text-xs text-muted">끄면 &lsquo;관심&rsquo;으로만 보입니다. 보유 여부는 본인이 등록한 정보이며 검증된 것이 아닙니다.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="community_push" defaultChecked={push} className="mt-1" />
        <span>
          <b>댓글 알림 푸시</b> — 내 글·댓글에 답이 달리면 바로 푸시로 알려 줍니다(설정에서 푸시를 켠 기기).
        </span>
      </label>
      {!agreed ? (
        <label className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent-soft/40 p-3 text-sm">
          <input type="checkbox" name="agree" required className="mt-1" />
          <span>
            <a href="/community/rules" target="_blank" className="font-semibold text-accent underline">운영 원칙</a>을 읽었고 동의합니다.
            <span className="block text-xs text-muted">집값 담합 유도·광고·욕설·개인정보 노출 금지, 위반 시 글이 가려지고 작성이 제한될 수 있습니다.</span>
          </span>
        </label>
      ) : null}
      {state.error ? <p role="alert" className="text-sm text-up">{state.error}</p> : state.ok ? <p className="text-sm text-ok">{state.ok}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "저장 중…" : nickname ? "저장" : "시작하기"}</Button>
    </form>
  );
}

/** 거주 인증: 단지 근처에서 위치 확인(서로 다른 날 3번) */
export function ResidenceCheck({ complexId, name, days, need, verified }: { complexId: number; name: string; days: number; need: number; verified: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [state, setState] = useState({ days, verified });
  const [busy, setBusy] = useState(false);
  function check() {
    if (!navigator.geolocation) return setMsg("이 브라우저는 위치 확인을 지원하지 않습니다.");
    setBusy(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await fetch("/api/community/residence", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ complexId, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "확인 실패");
          setState({ days: j.days, verified: j.verified });
          setMsg(j.verified ? "거주 인증이 완료되었습니다." : j.inRange ? `오늘 확인했습니다(${j.days}/${j.need}일). 다른 날 다시 확인하세요.` : `단지에서 ${j.distance}m 떨어져 있습니다. 단지 안에서 다시 시도하세요.`);
        } catch (e) {
          setMsg(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      },
      (e) => {
        setBusy(false);
        setMsg(e.code === e.PERMISSION_DENIED ? "위치 권한을 허용해 주세요." : "위치를 가져오지 못했습니다.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      {state.verified ? (
        <span className="text-xs font-semibold text-ok">인증됨</span>
      ) : (
        <>
          <span className="text-xs text-muted">{state.days}/{need}일</span>
          <Button type="button" variant="secondary" className="h-8 px-3 text-xs" disabled={busy} onClick={check}>
            <MapPin size={13} />
            {busy ? "확인 중…" : "지금 위치 확인"}
          </Button>
        </>
      )}
      {msg ? <p className="basis-full text-xs text-muted">{msg}</p> : null}
    </li>
  );
}
