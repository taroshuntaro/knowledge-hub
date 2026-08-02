import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createSession, getSessionUser } from '../services/session-service';
import { importUserDeactivations } from './user-deactivation-import';

describe('user deactivation import', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('複数ユーザーを無効化しセッションを失効させる', async () => {
    const a = await createTestUser(ctx.db, { email: 'a@example.com' });
    const b = await createTestUser(ctx.db, { email: 'b@example.com' });
    const sid = await createSession(ctx.db, a.id);

    const csv = ['email', 'a@example.com', 'b@example.com'].join('\n');
    const result = await importUserDeactivations(ctx.db, csv);

    expect(result).toEqual({ ok: true, deactivated: 2 });
    expect(await getSessionUser(ctx.db, sid)).toBeNull();
    const [rowA] = await ctx.db.select().from(users).where(eq(users.id, a.id));
    expect(rowA.isActive).toBe(false);
    const [rowB] = await ctx.db.select().from(users).where(eq(users.id, b.id));
    expect(rowB.isActive).toBe(false);
  });

  it('email を正規化（trim + 小文字化）して照合する', async () => {
    const a = await createTestUser(ctx.db, { email: 'mixed@example.com' });
    const csv = ['email', ' MIXED@Example.com '].join('\n');
    const result = await importUserDeactivations(ctx.db, csv);
    expect(result).toEqual({ ok: true, deactivated: 1 });
    const [rowA] = await ctx.db.select().from(users).where(eq(users.id, a.id));
    expect(rowA.isActive).toBe(false);
  });

  it('既に無効なユーザーは no-op としてカウントされる（deactivateUsers に委譲）', async () => {
    const a = await createTestUser(ctx.db, { email: 'a@example.com', isActive: false });
    const csv = ['email', 'a@example.com'].join('\n');
    const result = await importUserDeactivations(ctx.db, csv);
    expect(result).toEqual({ ok: true, deactivated: 0 });
  });

  it('未知の email は行エラー（all-or-nothing で何も無効化しない）', async () => {
    const a = await createTestUser(ctx.db, { email: 'a@example.com' });
    const csv = ['email', 'a@example.com', 'unknown@example.com'].join('\n');
    const result = await importUserDeactivations(ctx.db, csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors).toEqual([
      { line: 3, email: 'unknown@example.com', message: 'このメールアドレスのユーザーがいません' },
    ]);
    const [rowA] = await ctx.db.select().from(users).where(eq(users.id, a.id));
    expect(rowA.isActive).toBe(true);
  });

  it('CSV 内の重複 email は行エラー', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const csv = ['email', 'a@example.com', 'a@example.com'].join('\n');
    const result = await importUserDeactivations(ctx.db, csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors).toEqual([
      { line: 3, email: 'a@example.com', message: '同じ email の行が重複しています' },
    ]);
  });

  it('ヘッダー不正・空 CSV を弾く', async () => {
    const badHeader = await importUserDeactivations(ctx.db, 'mail\na@example.com');
    expect(badHeader.ok).toBe(false);
    if (badHeader.ok) throw new Error('unreachable');
    expect(badHeader.errors[0].line).toBe(1);

    const empty = await importUserDeactivations(ctx.db, '');
    expect(empty.ok).toBe(false);
  });

  it('列数が不正な行は行エラー', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const csv = ['email', 'a@example.com,extra'].join('\n');
    const result = await importUserDeactivations(ctx.db, csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.errors[0]).toMatchObject({ line: 2 });
  });

  it('バッチでログイン可能な管理者が 0 になるなら LAST_ADMIN が伝播する（行エラーにしない）', async () => {
    const admin1 = await createTestUser(ctx.db, { email: 'admin1@example.com', role: 'admin' });
    const admin2 = await createTestUser(ctx.db, { email: 'admin2@example.com', role: 'admin' });
    const csv = ['email', admin1.email, admin2.email].join('\n');
    await expect(importUserDeactivations(ctx.db, csv)).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });
});
