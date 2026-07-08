import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../db/schema';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { loginWithPassword } from './auth-service';
import { resolveOidcUser } from './oidc-service';

describe('resolveOidcUser', () => {
  const ctx = createTestApp();

  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('新規 email は member / oidc / passwordHash null で JIT 作成される', async () => {
    const u = await resolveOidcUser(
      ctx.db,
      { email: 'New.User@Example.com', emailVerified: true, name: 'New User' },
      [],
    );
    expect(u).toMatchObject({
      email: 'new.user@example.com',
      displayName: 'New User',
      role: 'member',
      authProvider: 'oidc',
      passwordHash: null,
    });
  });

  it('name claim がなければ email ローカル部が displayName になる', async () => {
    const u = await resolveOidcUser(ctx.db, { email: 'taro@example.com' }, []);
    expect(u.displayName).toBe('taro');
  });

  it('既存パスワードユーザーは email 検証済みなら自動リンクされ SSO 専用化される', async () => {
    const existing = await createTestUser(ctx.db, {
      authProvider: 'password',
      email: 'linked@example.com',
    });

    const u = await resolveOidcUser(ctx.db, { email: existing.email, emailVerified: true }, []);

    expect(u.id).toBe(existing.id);
    expect(u.authProvider).toBe('oidc');
    expect(u.passwordHash).toBeNull();
    expect(await loginWithPassword(ctx.db, existing.email, TEST_PASSWORD)).toBeNull();
  });

  it('既存パスワードユーザーは email 未検証だと自動リンクせず OIDC_LINK_UNVERIFIED で拒否される', async () => {
    const existing = await createTestUser(ctx.db, {
      authProvider: 'password',
      email: 'noverifylink@example.com',
    });

    // emailVerified 省略（未検証）では乗っ取り経路を塞ぐ
    await expect(
      resolveOidcUser(ctx.db, { email: existing.email }, []),
    ).rejects.toMatchObject({ code: 'OIDC_LINK_UNVERIFIED' });

    // パスワードアカウントは無傷のまま
    const row = await ctx.db.query.users.findFirst({ where: eq(users.id, existing.id) });
    expect(row?.authProvider).toBe('password');
    expect(row?.passwordHash).not.toBeNull();
  });

  it('oidc 既存ユーザーはそのままログインできる', async () => {
    const first = await resolveOidcUser(ctx.db, { email: 'repeat@example.com' }, []);
    const second = await resolveOidcUser(ctx.db, { email: 'repeat@example.com' }, []);

    expect(second.id).toBe(first.id);
    const rows = await ctx.db.query.users.findMany();
    expect(rows).toHaveLength(1);
  });

  it('無効化ユーザーは OIDC_INACTIVE で拒否される', async () => {
    const inactive = await createTestUser(ctx.db, {
      authProvider: 'oidc',
      passwordHash: null,
      isActive: false,
      email: 'inactive@example.com',
    });

    await expect(
      resolveOidcUser(ctx.db, { email: inactive.email }, []),
    ).rejects.toMatchObject({ code: 'OIDC_INACTIVE' });
  });

  it('email claim なしは OIDC_EMAIL で拒否される', async () => {
    await expect(resolveOidcUser(ctx.db, {}, [])).rejects.toMatchObject({
      code: 'OIDC_EMAIL',
    });
  });

  it('email_verified=false は OIDC_EMAIL で拒否される', async () => {
    await expect(
      resolveOidcUser(ctx.db, { email: 'unverified@example.com', emailVerified: false }, []),
    ).rejects.toMatchObject({ code: 'OIDC_EMAIL' });
  });

  it('email_verified 未提供(undefined)は許容される', async () => {
    await expect(
      resolveOidcUser(ctx.db, { email: 'noverify@example.com' }, []),
    ).resolves.toBeDefined();
  });

  it('ドメイン制限に合わないと OIDC_DOMAIN で拒否される（既存ユーザーでも）', async () => {
    const existing = await createTestUser(ctx.db, { email: 'user@other.com' });

    await expect(
      resolveOidcUser(ctx.db, { email: 'new@other.com' }, ['corp.example.com']),
    ).rejects.toMatchObject({ code: 'OIDC_DOMAIN' });
    await expect(
      resolveOidcUser(ctx.db, { email: existing.email }, ['corp.example.com']),
    ).rejects.toMatchObject({ code: 'OIDC_DOMAIN' });
  });

  it('並行 JIT は 1 ユーザーに収束する（一意制約フォールバック）', async () => {
    const results = await Promise.allSettled([
      resolveOidcUser(ctx.db, { email: 'race@example.com' }, []),
      resolveOidcUser(ctx.db, { email: 'race@example.com' }, []),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const ids = results.map(
      (r) => (r as PromiseFulfilledResult<{ id: string }>).value.id,
    );
    expect(new Set(ids).size).toBe(1);
  });
});
