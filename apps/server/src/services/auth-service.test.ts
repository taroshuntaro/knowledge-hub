import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessions, users } from '../db/schema';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { loginWithPassword } from './auth-service';
import { verifyPassword } from './password';

vi.mock('./password', async () => {
  const actual = await vi.importActual<typeof import('./password')>('./password');
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

describe('password login', () => {
  const ctx = createTestApp();

  beforeEach(async () => {
    vi.mocked(verifyPassword).mockClear();
    await resetDb(ctx.db);
  });
  afterAll(() => ctx.pool.end());

  it('正しいメールアドレスとパスワードでログインする', async () => {
    const created = await createTestUser(ctx.db, {
      email: 'login@example.com',
      displayName: 'ログイン利用者',
      role: 'admin',
      avatarUrl: 'https://example.com/avatar.png',
      bio: 'プロフィール',
    });

    const result = await loginWithPassword(ctx.db, created.email, TEST_PASSWORD);

    expect(result?.sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result?.user).toEqual({
      id: created.id,
      email: created.email,
      displayName: 'ログイン利用者',
      role: 'admin',
      avatarUrl: 'https://example.com/avatar.png',
      bio: 'プロフィール',
    });
  });

  it('誤ったパスワードを拒否する', async () => {
    const user = await createTestUser(ctx.db);

    expect(await loginWithPassword(ctx.db, user.email, 'wrong-password')).toBeNull();
  });

  it('存在しないメールアドレスを拒否する', async () => {
    expect(
      await loginWithPassword(ctx.db, 'missing@example.com', TEST_PASSWORD),
    ).toBeNull();
  });

  it('無効なユーザーを拒否する', async () => {
    const user = await createTestUser(ctx.db, { isActive: false });

    expect(await loginWithPassword(ctx.db, user.email, TEST_PASSWORD)).toBeNull();
  });

  it('パスワードハッシュがない OIDC ユーザーを拒否する', async () => {
    const user = await createTestUser(ctx.db, {
      authProvider: 'oidc',
      passwordHash: null,
    });

    expect(await loginWithPassword(ctx.db, user.email, TEST_PASSWORD)).toBeNull();
  });

  it('不適格なユーザーでも固定コストのパスワード検証を行う', async () => {
    const inactive = await createTestUser(ctx.db, { isActive: false });
    const oidc = await createTestUser(ctx.db, { authProvider: 'oidc' });
    const hashless = await createTestUser(ctx.db, { passwordHash: null });

    const results = await Promise.all([
      loginWithPassword(ctx.db, 'missing@example.com', TEST_PASSWORD),
      loginWithPassword(ctx.db, inactive.email, TEST_PASSWORD),
      loginWithPassword(ctx.db, oidc.email, TEST_PASSWORD),
      loginWithPassword(ctx.db, hashless.email, TEST_PASSWORD),
    ]);

    expect(results).toEqual([null, null, null, null]);
    expect(verifyPassword).toHaveBeenCalledTimes(4);
    const verifiedHashes = vi.mocked(verifyPassword).mock.calls.map(([, hash]) => hash);
    expect(new Set(verifiedHashes).size).toBe(1);
    expect(verifiedHashes[0]).toMatch(/^scrypt:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{86}$/);
  });

  it('検証中に無効化されたユーザーのセッションを作成しない', async () => {
    const user = await createTestUser(ctx.db);
    let releaseVerification!: (result: boolean) => void;
    let markVerificationStarted!: () => void;
    const verificationStarted = new Promise<void>((resolve) => {
      markVerificationStarted = resolve;
    });
    vi.mocked(verifyPassword).mockImplementationOnce(async () => {
      markVerificationStarted();
      return new Promise<boolean>((resolve) => {
        releaseVerification = resolve;
      });
    });

    const login = loginWithPassword(ctx.db, user.email, TEST_PASSWORD);
    await verificationStarted;
    await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, user.id));
    releaseVerification(true);

    await expect(login).resolves.toBeNull();
    expect(await ctx.db.select().from(sessions)).toHaveLength(0);
  });
});
