import nodemailer from 'nodemailer';
import type { Config } from '../config';

export type Mailer = {
  send(to: string, subject: string, text: string): Promise<void>;
};

export function createSmtpMailer(config: Config): Mailer {
  // 認証情報が両方揃っているときだけ auth を渡す（未設定 = Mailpit 等の認証なし SMTP）。
  // SMTP_SECURE=true で implicit TLS(465)。587 の STARTTLS は secure:false のまま
  // nodemailer が自動ネゴシエートする。パスワードはログに出さないこと。
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth:
      config.smtpUser !== undefined && config.smtpPassword !== undefined
        ? { user: config.smtpUser, pass: config.smtpPassword }
        : undefined,
  });
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: config.smtpFrom, to, subject, text });
    },
  };
}
