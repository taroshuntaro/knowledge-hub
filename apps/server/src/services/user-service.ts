import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { SessionUser } from '@knowledge-hub/shared';
import { users } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { hashPassword, verifyPassword } from './password';
import { deleteUserSessions, toSessionUser } from './session-service';

export async function updateProfile(
  db: Db,
  userId: string,
  input: { displayName: string; bio: string; avatarUrl?: string | null },
): Promise<SessionUser> {
  const [row] = await db
    .update(users)
    .set({
      displayName: input.displayName,
      bio: input.bio,
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    })
    .where(eq(users.id, userId))
    .returning();
  return toSessionUser(row);
}

export type PublicProfile = {
  id: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
};

export async function getPublicProfile(db: Db, id: string): Promise<PublicProfile> {
  // 不正な UUID 形式は DB エラー（500）ではなく NOT_FOUND として扱う
  // （既知の課題: 2a の :id 系ルートは malformed UUID で 500 になる。ここでは踏襲しない）
  if (!z.string().uuid().safeParse(id).success) {
    throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);
  }
  const row = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true, displayName: true, bio: true, avatarUrl: true },
  });
  if (!row) throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);
  return row;
}

export async function changePassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (user?.authProvider === 'oidc') {
    throw new AppError('FORBIDDEN', 'SSO アカウントはパスワードを変更できません', 403);
  }
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
  avatarUrl: string | null;
};

function toAdminView(row: typeof users.$inferSelect): AdminUserView {
  const { id, email, displayName, role, authProvider, isActive, createdAt, avatarUrl } = row;
  return { id, email, displayName, role, authProvider, isActive, createdAt, avatarUrl };
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
  // 降格判定と更新を1トランザクションにまとめ、アクティブ管理者行を FOR UPDATE で
  // ロックすることで、複数の管理者を同時に降格して0人になる TOCTOU レースを防ぐ。
  const row = await db.transaction(async (tx) => {
    const target = await tx.query.users.findFirst({ where: eq(users.id, targetId) });
    if (!target) throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);

    const demoting =
      target.role === 'admin' && (patch.role === 'member' || patch.isActive === false);
    if (demoting) {
      const activeAdmins = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
        .for('update');
      if (activeAdmins.length <= 1) {
        throw new AppError('LAST_ADMIN', '最後の管理者は降格・無効化できません', 409);
      }
    }

    const [updated] = await tx.update(users).set(patch).where(eq(users.id, targetId)).returning();
    return updated;
  });

  if (patch.isActive === false) await deleteUserSessions(db, targetId);
  return toAdminView(row);
}

export type MentionCandidate = { id: string; displayName: string; avatarUrl: string | null };

/** メンション候補（@ オートコンプリート用）。email 等の非公開情報は絶対に含めない。 */
export async function listMentionCandidates(db: Db): Promise<MentionCandidate[]> {
  return db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(users.displayName);
}
