import { and, eq, inArray, ne } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { departments, positions, uploads, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { hashPassword, verifyPassword } from './password';
import { deleteUserSessions, toSessionUser } from './session-service';

const AVATAR_URL_PREFIX = '/api/uploads/';

// 「ログイン可能な管理者」の定義を1箇所に集約する。role=admin かつ isActive だけでは
// pending（登録コード未 claim でパスワードもログイン手段も持たない）を admin としてカウント
// してしまい、最後の実ログイン可能管理者を降格・無効化できてしまう事故になる。
// 降格ガード（updateUserByAdmin）・一括無効化（deactivateUsers）の両方でこれを使う。
const loginableAdminWhere = () =>
  and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.authProvider, 'pending'));

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
  authProvider: 'oidc' | 'password' | 'pending';
  isActive: boolean;
  createdAt: Date;
  avatarUrl: string | null;
  departmentId: string | null;
  positionId: string | null;
  hireYear: number | null;
};

export function toAdminView(row: typeof users.$inferSelect): AdminUserView {
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
        .where(loginableAdminWhere())
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

/**
 * 複数ユーザーを一括無効化する（管理画面 / CSV 一括無効化の共通実装）。
 * - 不在 id が1件でもあれば NOT_FOUND で全体を失敗させる（部分適用しない）。
 * - 既に無効なユーザーは no-op（カウントしない・冪等）。
 * - 対象に現在ログイン可能な管理者が含まれ、かつ実行後にログイン可能な管理者が0人に
 *   なるなら LAST_ADMIN で全体を拒否する（管理者を含まないバッチは対象外。対象行を
 *   FOR UPDATE でロックし、複数バッチの同時実行で0人になる TOCTOU を防ぐ）。
 * - 成功時は無効化した全員のセッションを削除する（トランザクション確定後に実施）。
 */
export async function deactivateUsers(db: Db, userIds: string[]): Promise<{ deactivated: number }> {
  const ids = [...new Set(userIds)];
  const targets = await db.transaction(async (tx) => {
    const found = await tx.select().from(users).where(inArray(users.id, ids)).for('update');
    if (found.length !== ids.length) throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);

    const admins = await tx.select({ id: users.id }).from(users).where(loginableAdminWhere()).for('update');
    const targetSet = new Set(ids);
    const removingAdmin = admins.some((a) => targetSet.has(a.id));
    const remaining = admins.filter((a) => !targetSet.has(a.id)).length;
    // バッチが1人も管理者を含まないなら、管理者数はこの操作で変化しないためガード不要
    // （テスト環境など初期状態で管理者が0人のケースで、無関係な一般ユーザーの無効化まで
    // 誤って LAST_ADMIN にしてしまう false positive を避ける）。
    if (removingAdmin && remaining === 0) {
      throw new AppError('LAST_ADMIN', '最後の管理者は無効化できません', 409);
    }

    const toDeactivate = found.filter((u) => u.isActive).map((u) => u.id);
    if (toDeactivate.length > 0) {
      await tx.update(users).set({ isActive: false }).where(inArray(users.id, toDeactivate));
    }
    return toDeactivate;
  });

  await Promise.all(targets.map((id) => deleteUserSessions(db, id)));
  return { deactivated: targets.length };
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
