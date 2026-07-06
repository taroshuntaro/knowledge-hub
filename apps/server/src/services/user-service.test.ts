import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createSession, getSessionUser } from './session-service';
import { changePassword, getPublicProfile, updateProfile } from './user-service';

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

  it('avatarUrl を設定できる', async () => {
    const u = await createTestUser(ctx.db);
    const updated = await updateProfile(ctx.db, u.id, {
      displayName: u.displayName,
      bio: u.bio ?? '',
      avatarUrl: '/api/uploads/11111111-1111-1111-1111-111111111111',
    });
    expect(updated.avatarUrl).toBe('/api/uploads/11111111-1111-1111-1111-111111111111');
  });

  it('avatarUrl を null にすると削除される', async () => {
    const u = await createTestUser(ctx.db, {
      avatarUrl: '/api/uploads/11111111-1111-1111-1111-111111111111',
    });
    const updated = await updateProfile(ctx.db, u.id, {
      displayName: u.displayName,
      bio: u.bio ?? '',
      avatarUrl: null,
    });
    expect(updated.avatarUrl).toBeNull();
  });

  it('avatarUrl を指定しない場合は既存値が変わらない', async () => {
    const u = await createTestUser(ctx.db, {
      avatarUrl: '/api/uploads/11111111-1111-1111-1111-111111111111',
    });
    const updated = await updateProfile(ctx.db, u.id, {
      displayName: '新しい名前',
      bio: u.bio ?? '',
    });
    expect(updated.avatarUrl).toBe('/api/uploads/11111111-1111-1111-1111-111111111111');
  });

  describe('getPublicProfile', () => {
    it('公開情報のみ返す（email/role/passwordHash を含まない）', async () => {
      const u = await createTestUser(ctx.db, {
        displayName: '公開太郎',
        bio: '自己紹介',
        avatarUrl: '/api/uploads/11111111-1111-1111-1111-111111111111',
      });
      const profile = await getPublicProfile(ctx.db, u.id);
      expect(profile).toEqual({
        id: u.id,
        displayName: '公開太郎',
        bio: '自己紹介',
        avatarUrl: '/api/uploads/11111111-1111-1111-1111-111111111111',
      });
      expect(profile).not.toHaveProperty('email');
      expect(profile).not.toHaveProperty('role');
      expect(profile).not.toHaveProperty('passwordHash');
    });

    it('存在しない UUID → NOT_FOUND', async () => {
      await expect(getPublicProfile(ctx.db, randomUUID())).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('不正な UUID 形式 → NOT_FOUND（500 にならない）', async () => {
      await expect(getPublicProfile(ctx.db, 'not-a-uuid')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
