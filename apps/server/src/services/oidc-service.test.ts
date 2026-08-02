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

  it('行がない email は OIDC_NOT_PROVISIONED で拒否される（JIT 廃止）', async () => {
    await expect(
      resolveOidcUser(ctx.db, { email: 'stranger@example.com', emailVerified: true }, []),
    ).rejects.toMatchObject({ code: 'OIDC_NOT_PROVISIONED' });
  });

  it('pending 行は初回 SSO でクレームされ oidc に確定する（事前作成時の displayName を維持）', async () => {
    await createTestUser(ctx.db, {
      email: 'pre@example.com',
      displayName: '事前 太郎',
      authProvider: 'pending',
      passwordHash: null,
    });

    const u = await resolveOidcUser(
      ctx.db,
      { email: 'pre@example.com', emailVerified: true, name: 'IdP Name' },
      [],
    );

    expect(u.authProvider).toBe('oidc');
    expect(u.passwordHash).toBeNull();
    expect(u.displayName).toBe('事前 太郎');
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
    const existing = await createTestUser(ctx.db, {
      authProvider: 'oidc',
      passwordHash: null,
      email: 'repeat@example.com',
    });

    const u = await resolveOidcUser(ctx.db, { email: 'repeat@example.com' }, []);

    expect(u.id).toBe(existing.id);
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

  it('無効化された pending ユーザーも OIDC_INACTIVE で拒否される（クレームさせない）', async () => {
    const inactivePending = await createTestUser(ctx.db, {
      authProvider: 'pending',
      passwordHash: null,
      isActive: false,
      email: 'inactive-pending@example.com',
    });

    await expect(
      resolveOidcUser(ctx.db, { email: inactivePending.email, emailVerified: true }, []),
    ).rejects.toMatchObject({ code: 'OIDC_INACTIVE' });

    const row = await ctx.db.query.users.findFirst({ where: eq(users.id, inactivePending.id) });
    expect(row?.authProvider).toBe('pending');
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
    await createTestUser(ctx.db, {
      email: 'noverify@example.com',
      displayName: '未検証 太郎',
      authProvider: 'pending',
      passwordHash: null,
    });

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
});
