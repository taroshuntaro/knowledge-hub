import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from './schema';
import { createTestApp, resetDb } from '../test/helpers';

describe('db schema', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('users を insert して select できる', async () => {
    const [row] = await ctx.db
      .insert(users)
      .values({ email: 'a@example.com', displayName: '太郎', authProvider: 'password' })
      .returning();
    expect(row.id).toMatch(/[0-9a-f-]{36}/);
    expect(row.role).toBe('member');
    expect(row.isActive).toBe(true);
  });

  it('email はユニーク制約違反で reject される', async () => {
    const v = { email: 'dup@example.com', displayName: 'A', authProvider: 'password' as const };
    await ctx.db.insert(users).values(v);
    await expect(ctx.db.insert(users).values(v)).rejects.toThrow();
  });

  it('不正な role は DB 制約違反で reject される', async () => {
    await expect(
      ctx.db.execute(sql`
        insert into users (email, display_name, role, auth_provider)
        values ('invalid-role@example.com', 'A', 'owner', 'password')
      `),
    ).rejects.toThrow();
  });

  it('不正な auth_provider は DB 制約違反で reject される', async () => {
    await expect(
      ctx.db.execute(sql`
        insert into users (email, display_name, auth_provider)
        values ('invalid-provider@example.com', 'A', 'saml')
      `),
    ).rejects.toThrow();
  });
});
