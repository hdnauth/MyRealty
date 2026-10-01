import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env";

/*
 * 사용자 AI 키 암호화(AES-256-GCM). 비밀값은 AI_KEY_SECRET, 없으면 AUTH_SECRET 에서 파생한다.
 * 비밀값을 바꾸면 저장된 키를 풀 수 없으니 사용자에게 다시 입력하게 한다(decrypt 가 null).
 */
function key(): Buffer {
  const secret = process.env.AI_KEY_SECRET || env.authSecret;
  if (!secret) throw new Error("AI_KEY_SECRET 또는 AUTH_SECRET 환경 변수가 필요합니다.");
  return createHash("sha256").update(`myrealty:ai-key:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function keyHint(plain: string): string {
  return plain.length > 8 ? `…${plain.slice(-4)}` : "…";
}
