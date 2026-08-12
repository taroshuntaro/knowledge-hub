import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { users, uploads } from '../db/schema';
import { createTestArticle, createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createSession, getSessionUser } from './session-service';
import {
  changePassword, deactivateUsers, deletePendingUser, getPublicProfile, listMentionCandidates,
  listUsers, unclaimUser, updateProfile, updateUserByAdmin,
} from './user-service';
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

  it('pending の管理者はアクティブ管理者に数えない（降格・無効化ガード）', async () => {
    const real = await createTestUser(ctx.db, { role: 'admin' });
    await createTestUser(ctx.db, {
      role: 'admin', authProvider: 'pending', passwordHash: null,
    });
    await expect(
      updateUserByAdmin(ctx.db, real.id, { role: 'member' }),
    ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    await expect(
      updateUserByAdmin(ctx.db, real.id, { isActive: false }),
    ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });

  it('pending の admin 自身を降格・無効化する場合はログイン可能管理者を減らさないので許可される', async () => {
    // ログイン可能管理者は 1 人（real）のみ。pending の admin 行を降格/無効化しても
    // loginableAdminWhere の対象外のままなので、ログイン可能管理者数は変化しない。
    await createTestUser(ctx.db, { role: 'admin' }); // real: 唯一のログイン可能管理者
    const pending = await createTestUser(ctx.db, {
      role: 'admin', authProvider: 'pending', passwordHash: null,
    });
    await expect(
      updateUserByAdmin(ctx.db, pending.id, { role: 'member' }),
    ).resolves.toMatchObject({ role: 'member' });

    const pending2 = await createTestUser(ctx.db, {
      role: 'admin', authProvider: 'pending', passwordHash: null,
    });
    await expect(
      updateUserByAdmin(ctx.db, pending2.id, { isActive: false }),
    ).resolves.toMatchObject({ isActive: false });
  });

  it('pending ユーザーを admin に昇格させようとすると VALIDATION', async () => {
    const p = await createTestUser(ctx.db, { authProvider: 'pending', passwordHash: null });
    await expect(
      updateUserByAdmin(ctx.db, p.id, { role: 'admin' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const rows = await ctx.db.select().from(users).where(eq(users.id, p.id));
    expect(rows[0].role).toBe('member');
  });

  it('クレーム済みユーザーを admin に昇格させられる', async () => {
    const member = await createTestUser(ctx.db);
    const updated = await updateUserByAdmin(ctx.db, member.id, { role: 'admin' });
    expect(updated.role).toBe('admin');
  });

  it('pending はメンション候補に出ず、プロフィールは 404', async () => {
    const p = await createTestUser(ctx.db, {
      displayName: 'ペンディング花子', authProvider: 'pending', passwordHash: null,
    });
    const candidates = await listMentionCandidates(ctx.db);
    expect(candidates.map((u) => u.displayName)).not.toContain('ペンディング花子');
    await expect(getPublicProfile(ctx.db, p.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  describe('deletePendingUser', () => {
    it('pending ユーザーを削除できる', async () => {
      const p = await createTestUser(ctx.db, { authProvider: 'pending', passwordHash: null });
      await deletePendingUser(ctx.db, p.id);
      const rows = await ctx.db.select().from(users).where(eq(users.id, p.id));
      expect(rows).toHaveLength(0);
    });

    it('不在 id は NOT_FOUND', async () => {
      await expect(
        deletePendingUser(ctx.db, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('クレーム済みユーザーは CONFLICT で削除できない', async () => {
      const u = await createTestUser(ctx.db);
      await expect(deletePendingUser(ctx.db, u.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      const rows = await ctx.db.select().from(users).where(eq(users.id, u.id));
      expect(rows).toHaveLength(1);
    });

    it('unclaim 後もコンテンツ（記事）を持つ pending 行は CONFLICT で削除できない', async () => {
      const u = await createTestUser(ctx.db);
      await createTestArticle(ctx.db, { authorId: u.id });
      await unclaimUser(ctx.db, u.id);

      await expect(deletePendingUser(ctx.db, u.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      const rows = await ctx.db.select().from(users).where(eq(users.id, u.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe('unclaimUser', () => {
    it('クレーム済みユーザーを pending に戻しセッションを失効させる', async () => {
      const u = await createTestUser(ctx.db, { email: 'u@example.com' });
      const sid = await createSession(ctx.db, u.id);

      const view = await unclaimUser(ctx.db, u.id);

      expect(view.authProvider).toBe('pending');
      expect(await getSessionUser(ctx.db, sid)).toBeNull();
      const rows = await ctx.db.select().from(users).where(eq(users.id, u.id));
      expect(rows[0].passwordHash).toBeNull();
    });

    it('不在 id は NOT_FOUND', async () => {
      await expect(
        unclaimUser(ctx.db, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('既に pending の対象は CONFLICT', async () => {
      const p = await createTestUser(ctx.db, { authProvider: 'pending', passwordHash: null });
      await expect(unclaimUser(ctx.db, p.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('最後のログイン可能管理者は unclaim できず LAST_ADMIN', async () => {
      const admin = await createTestUser(ctx.db, { role: 'admin' });
      await expect(unclaimUser(ctx.db, admin.id)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    });

    it('admin を unclaim すると member へ降格する（pending 行は常に member）', async () => {
      await createTestUser(ctx.db, { email: 'other-admin@example.com', role: 'admin' });
      const admin = await createTestUser(ctx.db, { email: 'target-admin@example.com', role: 'admin' });

      const view = await unclaimUser(ctx.db, admin.id);

      expect(view.role).toBe('member');
      expect(view.authProvider).toBe('pending');
      const rows = await ctx.db.select().from(users).where(eq(users.id, admin.id));
      expect(rows[0].role).toBe('member');
    });

    it('member を unclaim しても role は変わらない', async () => {
      const member = await createTestUser(ctx.db);
      const view = await unclaimUser(ctx.db, member.id);
      expect(view.role).toBe('member');
      const rows = await ctx.db.select().from(users).where(eq(users.id, member.id));
      expect(rows[0].role).toBe('member');
    });

    it('並行する admin 昇格と unclaim が交錯しても pending の admin 行は生じない', async () => {
      // target 読み取りの FOR UPDATE がないと「クレーム済みを見て昇格 → 直後に unclaim が
      // stale な member role を見て降格スキップ」の交錯で pending+admin 行が生まれうる。
      // どちらが先に確定しても最終状態が不変条件を満たすことを複数回検証する。
      await createTestUser(ctx.db, { role: 'admin' }); // LAST_ADMIN 回避用の別 admin
      for (let i = 0; i < 5; i++) {
        const target = await createTestUser(ctx.db);
        const results = await Promise.allSettled([
          updateUserByAdmin(ctx.db, target.id, { role: 'admin' }),
          unclaimUser(ctx.db, target.id),
        ]);
        // unclaim は必ず成功する（昇格は先行 unclaim に負けた場合のみ VALIDATION で拒否）
        expect(results[1].status).toBe('fulfilled');
        const [row] = await ctx.db.select().from(users).where(eq(users.id, target.id));
        expect(row.authProvider).toBe('pending');
        expect(row.role).toBe('member');
      }
    });
  });

  describe('deactivateUsers', () => {
    it('複数ユーザーを無効化しセッションを失効させる', async () => {
      const a = await createTestUser(ctx.db, { email: 'a@example.com' });
      const b = await createTestUser(ctx.db, { email: 'b@example.com' });
      const sid = await createSession(ctx.db, a.id);

      const result = await deactivateUsers(ctx.db, [a.id, b.id]);

      expect(result.deactivated).toBe(2);
      expect(await getSessionUser(ctx.db, sid)).toBeNull();
      const rows = await ctx.db.select().from(users).where(eq(users.id, a.id));
      expect(rows[0].isActive).toBe(false);
    });

    it('既に無効なユーザーは no-op（冪等）', async () => {
      const a = await createTestUser(ctx.db, { email: 'a@example.com', isActive: false });
      const result = await deactivateUsers(ctx.db, [a.id]);
      expect(result.deactivated).toBe(0);
    });

    it('バッチでログイン可能な管理者が 0 になるなら LAST_ADMIN', async () => {
      const admin1 = await createTestUser(ctx.db, { email: 'a1@example.com', role: 'admin' });
      const admin2 = await createTestUser(ctx.db, { email: 'a2@example.com', role: 'admin' });
      await expect(
        deactivateUsers(ctx.db, [admin1.id, admin2.id]),
      ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    });

    it('pending の管理者はアクティブ管理者に数えない', async () => {
      const real = await createTestUser(ctx.db, { email: 'real@example.com', role: 'admin' });
      await createTestUser(ctx.db, {
        email: 'pend@example.com', role: 'admin', authProvider: 'pending', passwordHash: null,
      });
      await expect(
        deactivateUsers(ctx.db, [real.id]),
      ).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    });

    it('不在 id は NOT_FOUND で全体失敗', async () => {
      const a = await createTestUser(ctx.db, { email: 'a@example.com' });
      await expect(
        deactivateUsers(ctx.db, [a.id, '00000000-0000-0000-0000-000000000000']),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const rows = await ctx.db.select().from(users).where(eq(users.id, a.id));
      expect(rows[0].isActive).toBe(true);
    });
  });
});
