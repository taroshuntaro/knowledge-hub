import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTransportMock = vi.fn(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({
  default: { createTransport: (...a: unknown[]) => createTransportMock(...a) },
}));

import { loadConfig } from '../config';
import { createSmtpMailer } from './mailer';

const base = { DATABASE_URL: 'postgres://x' };

describe('createSmtpMailer', () => {
  beforeEach(() => createTransportMock.mockClear());

  it('認証未設定なら auth を渡さない（Mailpit 互換・secure false）', () => {
    createSmtpMailer(loadConfig(base));
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 1025, secure: false, auth: undefined }),
    );
  });

  it('SMTP_USER/PASSWORD/SECURE を transport に渡す', () => {
    createSmtpMailer(
      loadConfig({ ...base, SMTP_USER: 'mailer', SMTP_PASSWORD: 'secret-pass', SMTP_SECURE: 'true' }),
    );
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, auth: { user: 'mailer', pass: 'secret-pass' } }),
    );
  });
});
