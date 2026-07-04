import nodemailer from 'nodemailer';
import type { Config } from '../config';

export type Mailer = {
  send(to: string, subject: string, text: string): Promise<void>;
};

export function createSmtpMailer(config: Config): Mailer {
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: false,
  });
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: config.smtpFrom, to, subject, text });
    },
  };
}
