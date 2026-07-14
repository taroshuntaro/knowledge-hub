import { and, eq } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { departments, positions, uploads, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { hashPassword, verifyPassword } from './password';
import { deleteUserSessions, toSessionUser } from './session-service';

const AVATAR_URL_PREFIX = '/api/uploads/';

export async function updateProfile(
  db: Db,
  userId: string,
  input: { displayName: string; bio: string; avatarUrl?: string | null },
): Promise<SessionUser> {
  // updateProfileSchema が形式（/api/uploads/<uuid> アンカー付き）を保証済み。
  // ここでは「実在し、本人がアップロードしたものか」を検証する（他人の upload UUID を
  // アバターに据えると、upload GET の可視性がアバター経由で緩む・出所不明の画像を
  // 自分のプロフィールに紐づけられる、を防ぐ）。
  if (input.avatarUrl) {
    const uploadId = input.avatarUrl.slice(AVATAR_URL_PREFIX.length);
    const owned = await db.query.uploads.findFirst({
      where: and(eq(uploads.id, uploadId), eq(uploads.uploaderId, userId)),
      columns: { id: true },
    });
    if (!owned) throw new AppError('VALIDATION', 'アバター画像が不正です', 400);
  }

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
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  hireYear: number | null;
};

export async function getPublicProfile(db: Db, id: string): Promise<PublicProfile> {
  // UUID 形式の検証はルート層（requireUuidParam）に一元化した。
  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      bio: users.bio,
      avatarUrl: users.avatarUrl,
      hireYear: users.hireYear,
      departmentId: departments.id,
      departmentName: departments.name,
      positionId: positions.id,
      positionName: positions.name,
    })
    .from(users)
    .leftJoin(departments, eq(users.departmentId, departments.id))
    .leftJoin(positions, eq(users.positionId, positions.id))
    .where(eq(users.id, id));
  if (!row) throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);
  return {
    id: row.id,
    displayName: row.displayName,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    hireYear: row.hireYear,
    department: row.departmentId ? { id: row.departmentId, name: row.departmentName! } : null,
    position: row.positionId ? { id: row.positionId, name: row.positionName! } : null,
  };
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
  departmentId: string | null;
  positionId: string | null;
  hireYear: number | null;
};

function toAdminView(row: typeof users.$inferSelect): AdminUserView {
  const {
    id, email, displayName, role, authProvider, isActive, createdAt, avatarUrl,
    departmentId, positionId, hireYear,
  } = row;
  return {
    id, email, displayName, role, authProvider, isActive, createdAt, avatarUrl,
    departmentId, positionId, hireYear,
  };
}

export async function listUsers(db: Db): Promise<AdminUserView[]> {
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return rows.map(toAdminView);
}

export async function updateUserByAdmin(
  db: Db,
  targetId: string,
  patch: {
    role?: 'member' | 'admin';
    isActive?: boolean;
    departmentId?: string | null;
    positionId?: string | null;
    hireYear?: number | null;
  },
): Promise<AdminUserView> {
  // 降格判定と更新を1トランザクションにまとめ、アクティブ管理者行を FOR UPDATE で
  // ロックすることで、複数の管理者を同時に降格して0人になる TOCTOU レースを防ぐ。
  const row = await db.transaction(async (tx) => {
    const target = await tx.query.users.findFirst({ where: eq(users.id, targetId) });
    if (!target) throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);

    // FK 違反を 500 にせず、割当先の実在をアプリ層で 400 にする
    if (patch.departmentId) {
      const dep = await tx.query.departments.findFirst({
        where: eq(departments.id, patch.departmentId), columns: { id: true },
      });
      if (!dep) throw new AppError('VALIDATION', '所属が存在しません', 400);
    }
    if (patch.positionId) {
      const pos = await tx.query.positions.findFirst({
        where: eq(positions.id, patch.positionId), columns: { id: true },
      });
      if (!pos) throw new AppError('VALIDATION', '役職が存在しません', 400);
    }

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
