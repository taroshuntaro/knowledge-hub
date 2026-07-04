import { and, count, eq } from 'drizzle-orm';
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

export type AdminUserView = {
  id: string;
  email: string;
  displayName: string;
  role: 'member' | 'admin';
  authProvider: 'oidc' | 'password';
  isActive: boolean;
  createdAt: Date;
};

function toAdminView(row: typeof users.$inferSelect): AdminUserView {
  const { id, email, displayName, role, authProvider, isActive, createdAt } = row;
  return { id, email, displayName, role, authProvider, isActive, createdAt };
}

export async function listUsers(db: Db): Promise<AdminUserView[]> {
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return rows.map(toAdminView);
}

export async function updateUserByAdmin(
  db: Db,
  targetId: string,
  patch: { role?: 'member' | 'admin'; isActive?: boolean },
): Promise<AdminUserView> {
  const target = await db.query.users.findFirst({ where: eq(users.id, targetId) });
  if (!target) throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);

  const demoting = target.role === 'admin' && (patch.role === 'member' || patch.isActive === false);
  if (demoting) {
    const [{ value: activeAdmins }] = await db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
    if (activeAdmins <= 1) {
      throw new AppError('LAST_ADMIN', '最後の管理者は降格・無効化できません', 409);
    }
  }

  const [row] = await db.update(users).set(patch).where(eq(users.id, targetId)).returning();
  if (patch.isActive === false) await deleteUserSessions(db, targetId);
  return toAdminView(row);
}
