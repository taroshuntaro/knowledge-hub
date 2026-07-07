import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { passwordResetTokens, users } from '../db/schema';
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

  it('同一トークンの並行使用は片方だけ成功する（M-3 アトミック消費）', async () => {
    const u = await createTestUser(ctx.db);
    await requestPasswordReset(ctx.db, ctx.mailer, config, u.email);
    const token = tokenFromMail();
    const results = await Promise.allSettled([
      resetPassword(ctx.db, token, 'new-password-aaa1'),
      resetPassword(ctx.db, token, 'new-password-bbb2'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'INVALID_TOKEN' });
    // 使われたのはどちらか一方のパスワードのみ
    const wins = [
      await loginWithPassword(ctx.db, u.email, 'new-password-aaa1'),
      await loginWithPassword(ctx.db, u.email, 'new-password-bbb2'),
    ].filter((r) => r !== null);
    expect(wins).toHaveLength(1);
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

  it('リクエスト後に OIDC 連携されたアカウントのトークンは INVALID_TOKEN で拒否され、消費もされない', async () => {
    const u = await createTestUser(ctx.db, { email: 'a@example.com' });
    await requestPasswordReset(ctx.db, ctx.mailer, config, 'a@example.com');
    const token = tokenFromMail();
    // ログイン方式変更後にトークンが提出されるケースを模倣
    await ctx.db
      .update(users)
      .set({ authProvider: 'oidc', passwordHash: null })
      .where(eq(users.id, u.id));

    await expect(resetPassword(ctx.db, token, 'brand-new-password')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
      message: 'リンクが無効か、期限切れです',
    });

    const after = await ctx.db.query.users.findFirst({ where: eq(users.id, u.id) });
    expect(after?.passwordHash).toBeNull();
    // トークンが未消費であること(usedAt が更新されていない)を確認
    const row = await ctx.db.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.userId, u.id),
    });
    expect(row?.usedAt).toBeNull();
  });

  it('リクエスト後に無効化されたアカウントのトークンは INVALID_TOKEN', async () => {
    const u = await createTestUser(ctx.db, { email: 'a@example.com' });
    await requestPasswordReset(ctx.db, ctx.mailer, config, 'a@example.com');
    const token = tokenFromMail();
    await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, u.id));

    await expect(resetPassword(ctx.db, token, 'brand-new-password')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });
});
