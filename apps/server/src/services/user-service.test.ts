import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { uploads } from '../db/schema';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createSession, getSessionUser } from './session-service';
import { changePassword, getPublicProfile, listUsers, updateProfile, updateUserByAdmin } from './user-service';
import { createDepartment, createPosition } from './master-service';

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

  it('changePassword は oidc ユーザーを 403 で拒否する', async () => {
    const u = await createTestUser(ctx.db, {
      authProvider: 'oidc',
      passwordHash: null,
    });
    await expect(
      changePassword(ctx.db, u.id, 'x', 'y'.repeat(12)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('avatarUrl を設定できる', async () => {
    const u = await createTestUser(ctx.db);
    const [upload] = await ctx.db
      .insert(uploads)
      .values({ uploaderId: u.id, storageKey: 'k', mimeType: 'image/png', size: 1 })
      .returning();
    const updated = await updateProfile(ctx.db, u.id, {
      displayName: u.displayName,
      bio: u.bio ?? '',
      avatarUrl: `/api/uploads/${upload.id}`,
    });
    expect(updated.avatarUrl).toBe(`/api/uploads/${upload.id}`);
  });

  it('avatarUrl が他人のアップロードを指す場合は VALIDATION', async () => {
    const u = await createTestUser(ctx.db);
    const other = await createTestUser(ctx.db);
    const [upload] = await ctx.db
      .insert(uploads)
      .values({ uploaderId: other.id, storageKey: 'k', mimeType: 'image/png', size: 1 })
      .returning();
    await expect(
      updateProfile(ctx.db, u.id, {
        displayName: u.displayName,
        bio: u.bio ?? '',
        avatarUrl: `/api/uploads/${upload.id}`,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('avatarUrl が存在しない upload を指す場合は VALIDATION', async () => {
    const u = await createTestUser(ctx.db);
    await expect(
      updateProfile(ctx.db, u.id, {
        displayName: u.displayName,
        bio: u.bio ?? '',
        avatarUrl: `/api/uploads/${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
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
        department: null,
        position: null,
        hireYear: null,
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
    // 不正な UUID 形式の弾き方はルート層（requireUuidParam）の責務に一元化したため、
    // その検証は routes/users.test.ts の GET /api/users/:id で行う。
  });

  it('admin 更新で所属・役職・入社年を設定/クリアでき、一覧・公開プロフィールに出る', async () => {
    const dep = await createDepartment(ctx.db, '開発部');
    const pos = await createPosition(ctx.db, '部長');
    const user = await createTestUser(ctx.db);

    const updated = await updateUserByAdmin(ctx.db, user.id, {
      departmentId: dep.id, positionId: pos.id, hireYear: 2020,
    });
    expect(updated).toMatchObject({ departmentId: dep.id, positionId: pos.id, hireYear: 2020 });

    const profile = await getPublicProfile(ctx.db, user.id);
    expect(profile.department).toEqual({ id: dep.id, name: '開発部' });
    expect(profile.position).toEqual({ id: pos.id, name: '部長' });
    expect(profile.hireYear).toBe(2020);

    const list = await listUsers(ctx.db);
    expect(list.find((u) => u.id === user.id)).toMatchObject({ departmentId: dep.id, hireYear: 2020 });

    const cleared = await updateUserByAdmin(ctx.db, user.id, {
      departmentId: null, positionId: null, hireYear: null,
    });
    expect(cleared).toMatchObject({ departmentId: null, positionId: null, hireYear: null });
  });

  it('存在しない所属/役職の割当は VALIDATION', async () => {
    const user = await createTestUser(ctx.db);
    const missing = '00000000-0000-0000-0000-000000000000';
    await expect(
      updateUserByAdmin(ctx.db, user.id, { departmentId: missing }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      updateUserByAdmin(ctx.db, user.id, { positionId: missing }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
