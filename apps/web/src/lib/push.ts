import "server-only";
import webpush from "web-push";
import { sql } from "./db";
import { env } from "./env";

export function pushConfigured() {
  return Boolean(env.vapidPublicKey && env.vapidPrivateKey);
}

export async function sendPushToUser(userId: string, payload: { title: string; body?: string; url?: string; tag?: string }) {
  if (!pushConfigured()) return { sent: 0, reason: "VAPID 미설정" };
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey!, env.vapidPrivateKey!);
  const subs = await sql<{ endpoint: string; keys: { p256dh: string; auth: string } }[]>`
    select endpoint, keys from push_subscriptions where user_id = ${userId}`;
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload));
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await sql`delete from push_subscriptions where endpoint = ${s.endpoint}`;
    }
  }
  return { sent };
}
