import { eq } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { users } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { hashPassword, verifyPassword } from './password';
import { deleteUserSessions, toSessionUser } from './session-service';

export async function updateProfile(
  db: Db,
  userId: string,
  input: { displayName: string; bio: string },
): Promise<SessionUser> {
  const [row] = await db.update(users).set(input).where(eq(users.id, userId)).returning();
  return toSessionUser(row);
}

export async function changePassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError('INVALID_CREDENTIALS', '現在のパスワードが正しくありません', 400);
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId));
  await deleteUserSessions(db, userId);
}
