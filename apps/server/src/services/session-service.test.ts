import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sessions } from '../db/schema';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  getSessionUser,
  hashToken,
  SESSION_TTL_MS,
} from './session-service';

describe('session service', () => {
  const ctx = createTestApp();

  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('セッションを作成し、ユーザー情報を取得できる', async () => {
    const user = await createTestUser(ctx.db, {
      email: 'session@example.com',
      displayName: 'セッション利用者',
      avatarUrl: 'https://example.com/avatar.png',
      bio: '自己紹介',
      role: 'admin',
    });

    const sid = await createSession(ctx.db, user.id);

    expect(await getSessionUser(ctx.db, sid)).toEqual({
      id: user.id,
      email: 'session@example.com',
      displayName: 'セッション利用者',
      role: 'admin',
      avatarUrl: 'https://example.com/avatar.png',
      bio: '自己紹介',
    });
  });

  it('平文のセッション ID ではなく SHA-256 ハッシュを保存する', async () => {
    const user = await createTestUser(ctx.db);

    const beforeCreate = Date.now();
    const sid = await createSession(ctx.db, user.id);
    const afterCreate = Date.now();
    const [stored] = await ctx.db.select().from(sessions);

    expect(stored.id).toBe(hashToken(sid));
    expect(stored.id).toBe(createHash('sha256').update(sid).digest('hex'));
    expect(stored.id).not.toBe(sid);
    expect(stored.userId).toBe(user.id);
    expect(stored.expiresAt.getTime()).toBeGreaterThanOrEqual(
      beforeCreate + SESSION_TTL_MS,
    );
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(afterCreate + SESSION_TTL_MS);
  });

  it('期限切れセッションを削除して null を返す', async () => {
    const user = await createTestUser(ctx.db);
    const sid = 'expired-session';
    const sessionId = hashToken(sid);
    await ctx.db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(Date.now() - 1_000),
    });

    expect(await getSessionUser(ctx.db, sid)).toBeNull();
    expect(
      await ctx.db.select().from(sessions).where(eq(sessions.id, sessionId)),
    ).toHaveLength(0);
  });

  it('無効なユーザーのセッションは null を返す', async () => {
    const user = await createTestUser(ctx.db, { isActive: false });
    const sid = await createSession(ctx.db, user.id);

    expect(await getSessionUser(ctx.db, sid)).toBeNull();
  });

  it('ユーザーの全セッションを削除する', async () => {
    const user = await createTestUser(ctx.db);
    const firstSid = await createSession(ctx.db, user.id);
    const secondSid = await createSession(ctx.db, user.id);

    await deleteUserSessions(ctx.db, user.id);

    expect(await getSessionUser(ctx.db, firstSid)).toBeNull();
    expect(await getSessionUser(ctx.db, secondSid)).toBeNull();
  });

  it('指定したセッションだけを削除する', async () => {
    const user = await createTestUser(ctx.db);
    const deletedSid = await createSession(ctx.db, user.id);
    const remainingSid = await createSession(ctx.db, user.id);

    await deleteSession(ctx.db, deletedSid);

    expect(await getSessionUser(ctx.db, deletedSid)).toBeNull();
    expect(await getSessionUser(ctx.db, remainingSid)).toMatchObject({ id: user.id });
  });
});
