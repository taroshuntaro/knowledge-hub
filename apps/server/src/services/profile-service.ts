import { asc, eq } from 'drizzle-orm';
import { departments, positions, users } from '../db/schema';
import type { Db } from '../types';
import { listDepartments, listPositions, type Master } from './master-service';

/** メンバー名簿の 1 件。email 等の非公開情報は絶対に含めない。 */
export type ProfileItem = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  hireYear: number | null;
};

export type ProfilesResponse = {
  users: ProfileItem[];
  departments: Master[];
  positions: Master[];
};

// 名簿規模（数百人）を想定し全件返す。検索・絞り込み・並び替えはクライアント側。
// 千人規模になったらサーバーサイドのフィルタ/ページングを検討する（spec 参照）。
export async function listProfiles(db: Db): Promise<ProfilesResponse> {
  const [rows, deps, poss] = await Promise.all([
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        hireYear: users.hireYear,
        departmentId: departments.id,
        departmentName: departments.name,
        positionId: positions.id,
        positionName: positions.name,
      })
      .from(users)
      .leftJoin(departments, eq(users.departmentId, departments.id))
      .leftJoin(positions, eq(users.positionId, positions.id))
      .where(eq(users.isActive, true))
      .orderBy(asc(users.displayName)),
    listDepartments(db),
    listPositions(db),
  ]);
  return {
    users: rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      bio: r.bio,
      hireYear: r.hireYear,
      department: r.departmentId ? { id: r.departmentId, name: r.departmentName! } : null,
      position: r.positionId ? { id: r.positionId, name: r.positionName! } : null,
    })),
    departments: deps,
    positions: poss,
  };
}
