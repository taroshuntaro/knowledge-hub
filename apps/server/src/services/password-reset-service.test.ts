import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb, testConfig } from '../test/helpers';
import { loginWithPassword } from './auth-service';
import { requestPasswordReset, resetPassword } from './password-reset-service';
import { createSession, getSessionUser } from './session-service';

describe('password reset', () => {
  const ctx = createTestApp();
  const config = testConfig();
  beforeEach(async () => {
    await resetDb(ctx.db);
    ctx.mailer.sent.length = 0;
  });
  afterAll(() => ctx.pool.end());

  function tokenFromMail(): string {
    const m = ctx.mailer.sent[0].text.match(/\/password-reset\/([A-Za-z0-9_-]+)/);
    if (!m) throw new Error('reset link not found');
    return m[1];
  }

  it('登録ユーザーにはリセットメールが飛ぶ', async () => {
    const u = await createTestUser(ctx.db);
    await requestPasswordReset(ctx.db, ctx.mailer, config, u.email);
    expect(ctx.mailer.sent).toHaveLength(1);
  });

  it('未登録メールでもエラーにせずメールも送らない', async () => {
    await requestPasswordReset(ctx.db, ctx.mailer, config, 'nobody@example.com');
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('リセット後は新パスワードでログインでき、既存セッションは失効する', async () => {
    const u = await createTestUser(ctx.db, { email: 'a@example.com' });
    const oldSid = await createSession(ctx.db, u.id);
    await requestPasswordReset(ctx.db, ctx.mailer, config, 'a@example.com');
    await resetPassword(ctx.db, tokenFromMail(), 'brand-new-password');
    expect(await loginWithPassword(ctx.db, 'a@example.com', 'brand-new-password')).not.toBeNull();
    expect(await getSessionUser(ctx.db, oldSid)).toBeNull();
  });

  it('使用済みトークンは INVALID_TOKEN', async () => {
    const u = await createTestUser(ctx.db);
    await requestPasswordReset(ctx.db, ctx.mailer, config, u.email);
    const token = tokenFromMail();
    await resetPassword(ctx.db, token, 'brand-new-password');
    await expect(resetPassword(ctx.db, token, 'another-password-x')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });
});
