import { createHash, randomBytes } from 'node:crypto';
import type { SessionUser } from '@knowledge-hub/shared';
import { eq } from 'drizzle-orm';
import { sessions, users } from '../db/schema';
import type { Db } from '../types';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toSessionUser(user: typeof users.$inferSelect): SessionUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
  };
}

type SessionStore = Pick<Db, 'insert'>;

export function createSession(db: Db, userId: string): Promise<string>;
export function createSession(db: SessionStore, userId: string): Promise<string>;
export async function createSession(db: SessionStore, userId: string): Promise<string> {
  const sid = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    id: hashToken(sid),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return sid;
}

export async function getSessionUser(db: Db, sid: string): Promise<SessionUser | null> {
  const id = hashToken(sid);
  const [result] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!result) return null;

  if (result.session.expiresAt <= new Date()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  if (!result.user.isActive) return null;
  return toSessionUser(result.user);
}

export async function deleteSession(db: Db, sid: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(sid)));
}

export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
