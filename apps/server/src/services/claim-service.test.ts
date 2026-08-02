import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../db/schema';
import { createTestApp, resetDb } from '../test/helpers';
import { claimAccount } from './claim-service';
import { issueRegistrationCode } from './registration-code-service';

describe('claimAccount', () => {
  const ctx = createTestApp();
  const { db } = ctx;
  beforeEach(() => resetDb(db));
  afterAll(() => ctx.pool.end());

  async function seedPending(email: string) {
    const [u] = await db.insert(users)
      .values({ email, displayName: '未ログイン', authProvider: 'pending', passwordHash: null })
      .returning();
    return u;
  }

  it('有効コード + pending 行で成功しセッションを返す', async () => {
    const { code } = await issueRegistrationCode(db, 30);
    await seedPending('new@example.com');
    const result = await claimAccount(db, { email: 'New@Example.com', code, password: 'p'.repeat(12) });
    expect(result?.user.authProvider).toBe('password');
    const [row] = await db.select().from(users).where(eq(users.email, 'new@example.com'));
    expect(row.authProvider).toBe('password');
    expect(row.passwordHash).not.toBeNull();
  });

  it.each([
    ['コード不一致', async () => { await issueRegistrationCode(db, 30); await seedPending('a@example.com'); return { email: 'a@example.com', code: 'AAAA-AAAA-AAAA-AAAA' }; }],
    ['行なし', async () => { const { code } = await issueRegistrationCode(db, 30); return { email: 'none@example.com', code }; }],
    ['クレーム済み', async () => { const { code } = await issueRegistrationCode(db, 30); await seedPending('b@example.com'); await claimAccount(db, { email: 'b@example.com', code, password: 'p'.repeat(12) }); return { email: 'b@example.com', code }; }],
    ['無効化済み pending', async () => { const { code } = await issueRegistrationCode(db, 30); const u = await seedPending('c@example.com'); await db.update(users).set({ isActive: false }).where(eq(users.id, u.id)); return { email: 'c@example.com', code }; }],
  ])('%s は null（統一失敗）', async (_label, arrange) => {
    const input = await arrange();
    expect(await claimAccount(db, { ...input, password: 'p'.repeat(12) })).toBeNull();
  });

  it('並行二重クレームは片方だけ成功する', async () => {
    const { code } = await issueRegistrationCode(db, 30);
    await seedPending('race@example.com');
    const results = await Promise.all([
      claimAccount(db, { email: 'race@example.com', code, password: 'p'.repeat(12) }),
      claimAccount(db, { email: 'race@example.com', code, password: 'q'.repeat(12) }),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});
