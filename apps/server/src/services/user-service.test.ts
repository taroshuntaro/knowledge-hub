import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createSession, getSessionUser } from './session-service';
import { changePassword, updateProfile } from './user-service';

describe('user service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('プロフィールを更新できる', async () => {
    const u = await createTestUser(ctx.db);
    const updated = await updateProfile(ctx.db, u.id, { displayName: '花子', bio: 'インフラ担当' });
    expect(updated.displayName).toBe('花子');
    expect(updated.bio).toBe('インフラ担当');
  });

  it('changePassword は現パスワード不一致で INVALID_CREDENTIALS', async () => {
    const u = await createTestUser(ctx.db);
    await expect(
      changePassword(ctx.db, u.id, 'wrong-current-pw', 'new-password-long'),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('changePassword 成功で既存セッションが失効する', async () => {
    const u = await createTestUser(ctx.db);
    const sid = await createSession(ctx.db, u.id);
    await changePassword(ctx.db, u.id, TEST_PASSWORD, 'new-password-long');
    expect(await getSessionUser(ctx.db, sid)).toBeNull();
  });
});
