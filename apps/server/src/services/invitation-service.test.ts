import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { invitations } from '../db/schema';
import { createTestUser } from '../test/factories';
import { hashToken } from './session-service';
import { createTestApp, resetDb, testConfig } from '../test/helpers';
import { acceptInvitation, createInvitation } from './invitation-service';
import { getSessionUser } from './session-service';

describe('invitation service', () => {
  const ctx = createTestApp();
  const config = testConfig();
  beforeEach(async () => {
    await resetDb(ctx.db);
    ctx.mailer.sent.length = 0;
  });
  afterAll(() => ctx.pool.end());

  function tokenFromMail(): string {
    const m = ctx.mailer.sent[0].text.match(/\/invite\/([A-Za-z0-9_-]+)/);
    if (!m) throw new Error('invite link not found in mail');
    return m[1];
  }

  it('招待メールを送り、トークンはハッシュで保存される', async () => {
    await createInvitation(ctx.db, ctx.mailer, config, 'new@example.com');
    expect(ctx.mailer.sent[0].to).toBe('new@example.com');
    const token = tokenFromMail();
    const rows = await ctx.db.select().from(invitations);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
  });

  it('既存ユーザーのメールには EMAIL_TAKEN', async () => {
    const u = await createTestUser(ctx.db);
    await expect(createInvitation(ctx.db, ctx.mailer, config, u.email)).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
  });

  it('受諾でユーザーとセッションが作られる', async () => {
    await createInvitation(ctx.db, ctx.mailer, config, 'new@example.com');
    const { sid, user } = await acceptInvitation(ctx.db, tokenFromMail(), {
      displayName: '新人',
      password: 'long-enough-password',
    });
    expect(user.email).toBe('new@example.com');
    expect((await getSessionUser(ctx.db, sid))?.id).toBe(user.id);
  });

  it('同じトークンの再受諾は INVALID_TOKEN', async () => {
    await createInvitation(ctx.db, ctx.mailer, config, 'new@example.com');
    const token = tokenFromMail();
    await acceptInvitation(ctx.db, token, { displayName: 'A', password: 'long-enough-password' });
    await expect(
      acceptInvitation(ctx.db, token, { displayName: 'B', password: 'long-enough-password' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('期限切れトークンは INVALID_TOKEN', async () => {
    await createInvitation(ctx.db, ctx.mailer, config, 'new@example.com');
    await ctx.db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(
      acceptInvitation(ctx.db, tokenFromMail(), { displayName: 'A', password: 'long-enough-password' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('デタラメなトークンは INVALID_TOKEN', async () => {
    await expect(
      acceptInvitation(ctx.db, 'bogus-token', { displayName: 'A', password: 'long-enough-password' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('メールが既に登録済みなら受諾は EMAIL_TAKEN（一意制約違反の500にしない）', async () => {
    // createInvitation は既存ユーザー宛を弾くため、招待行を直接投入して二重招待を再現する。
    const token = randomBytes(32).toString('base64url');
    await ctx.db.insert(invitations).values({
      email: 'dup@example.com',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createTestUser(ctx.db, { email: 'dup@example.com' });
    await expect(
      acceptInvitation(ctx.db, token, { displayName: 'A', password: 'long-enough-password' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });
});
