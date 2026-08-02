import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { createTestApp, resetDb } from '../test/helpers';
import { createPendingUser, importUserRegistrations } from './user-provision-service';

describe('user provision service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  describe('createPendingUser', () => {
    it('pending 行を member 固定で作成する', async () => {
      const view = await createPendingUser(ctx.db, { email: 'New@Example.com', displayName: '新井' });
      expect(view).toMatchObject({
        email: 'new@example.com', role: 'member', authProvider: 'pending', isActive: true,
      });
    });

    it('既存 email は EMAIL_TAKEN', async () => {
      await createPendingUser(ctx.db, { email: 'dup@example.com', displayName: 'A' });
      await expect(createPendingUser(ctx.db, { email: 'dup@example.com', displayName: 'B' }))
        .rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    });

    it('不在の departmentId は VALIDATION', async () => {
      await expect(createPendingUser(ctx.db, {
        email: 'a@example.com', displayName: 'A', departmentId: '00000000-0000-0000-0000-000000000000',
      })).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('不在の positionId は VALIDATION', async () => {
      await expect(createPendingUser(ctx.db, {
        email: 'a@example.com', displayName: 'A', positionId: '00000000-0000-0000-0000-000000000000',
      })).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('同一 email を同時作成しても片方は EMAIL_TAKEN（TOCTOU で 500 に漏れない）', async () => {
      const results = await Promise.allSettled([
        createPendingUser(ctx.db, { email: 'race@example.com', displayName: 'A' }),
        createPendingUser(ctx.db, { email: 'race@example.com', displayName: 'B' }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'EMAIL_TAKEN' });
    });
  });

  describe('importUserRegistrations', () => {
    const header = 'email,display_name,department,position,hire_year';

    it('all-or-nothing: 1 行でもエラーなら何も作らない', async () => {
      const result = await importUserRegistrations(
        ctx.db, `${header}\na@example.com,佐藤,,,\n,名無し,,,`,
      );
      expect(result.ok).toBe(false);
      expect(await ctx.db.$count(users)).toBe(0);
    });

    it('正常 CSV は pending 行を作成しマスタを自動登録する', async () => {
      const result = await importUserRegistrations(
        ctx.db, `${header}\na@example.com,佐藤,開発部,主任,2026\nb@example.com,鈴木,,,`,
      );
      expect(result).toMatchObject({ ok: true, created: 2, createdDepartments: ['開発部'], createdPositions: ['主任'] });
      const [a] = await ctx.db.select().from(users).where(eq(users.email, 'a@example.com'));
      expect(a.authProvider).toBe('pending');
      expect(a.hireYear).toBe(2026);
    });

    it('既存 email は行エラー', async () => {
      await createPendingUser(ctx.db, { email: 'dup@example.com', displayName: 'A' });
      const result = await importUserRegistrations(ctx.db, `${header}\ndup@example.com,重複,,,`);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toMatchObject({ line: 2, email: 'dup@example.com' });
    });

    it('display_name 空は行エラー / 重複 email 行は行エラー / ヘッダー不正はエラー', async () => {
      expect((await importUserRegistrations(ctx.db, `${header}\na@example.com,,,,`)).ok).toBe(false);
      expect((await importUserRegistrations(ctx.db, `${header}\na@example.com,x,,,\na@example.com,y,,,`)).ok).toBe(false);
      expect((await importUserRegistrations(ctx.db, 'email\na@example.com')).ok).toBe(false);
    });
  });
});
