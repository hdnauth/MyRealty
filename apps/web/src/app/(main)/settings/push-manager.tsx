"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { sendTestPushAction } from "./actions";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushManager({ vapidKey }: { vapidKey: string | null }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = "serviceWorker" in navigator && "PushManager" in window;
      if (!ok) {
        if (alive) setSupported(false);
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const s = await reg.pushManager.getSubscription();
      if (alive) {
        setSupported(true);
        setSub(s);
      }
    })().catch(() => alive && setSupported(false));
    return () => {
      alive = false;
    };
  }, []);

  if (!vapidKey) return <p className="text-sm text-muted">VAPID 키(NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)를 설정하면 웹푸시를 사용할 수 있습니다.</p>;
  if (supported === null) return <p className="text-sm text-muted">확인 중…</p>;
  if (!supported)
    return <p className="text-sm text-muted">이 브라우저는 웹푸시를 지원하지 않습니다. iPhone은 Safari 공유 → “홈 화면에 추가” 후 앱에서 설정하세요(iOS 16.4+).</p>;

  async function subscribe() {
    setMsg(null);
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setMsg("알림 권한이 거부되었습니다.");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey!) });
    const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
    if (r.ok) setSub(s);
    else setMsg("구독 저장에 실패했습니다.");
  }

  async function unsubscribe() {
    if (!sub) return;
    await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
    setSub(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sub ? (
        <>
          <span className="text-sm text-ok">이 기기에서 푸시를 받고 있습니다.</span>
          <Button variant="secondary" type="button" onClick={async () => setMsg((await sendTestPushAction()).message)}>
            테스트 발송
          </Button>
          <Button variant="ghost" type="button" onClick={unsubscribe}>
            해제
          </Button>
        </>
      ) : (
        <Button type="button" onClick={subscribe}>
          이 기기에서 푸시 받기
        </Button>
      )}
      {msg ? <span className="text-sm text-muted">{msg}</span> : null}
    </div>
  );
}
