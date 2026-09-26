import "server-only";
import nodemailer from "nodemailer";
import { env } from "./env";

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!env.smtp.host) {
    // SMTP 미설정(개발): 콘솔로 대신 출력
    console.info(`[mail:dev] to=${to} subject=${subject}\n${text}`);
    return { dev: true };
  }
  const transport = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
    // 서버리스에서 무한 대기하지 않도록
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transport.sendMail({ from: env.smtp.from, to, subject, text, html });
  return { dev: false };
}
