import { asc, eq, sql } from 'drizzle-orm';
import { departments, positions } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';

export type Master = { id: string; name: string; sortOrder: number };

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === '23505';
}

// ---- departments ----

export async function listDepartments(db: Db): Promise<Master[]> {
  return db
    .select({ id: departments.id, name: departments.name, sortOrder: departments.sortOrder })
    .from(departments)
    .orderBy(asc(departments.sortOrder), asc(departments.name));
}

export async function createDepartment(db: Db, name: string): Promise<Master> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${departments.sortOrder}), -1) + 1` })
    .from(departments);
  try {
    const [row] = await db.insert(departments).values({ name, sortOrder: next }).returning();
    return { id: row.id, name: row.name, sortOrder: row.sortOrder };
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError('CONFLICT', '同名の所属が既に存在します', 409);
    throw e;
  }
}

export async function updateDepartment(
  db: Db,
  id: string,
  patch: { name?: string; sortOrder?: number },
): Promise<Master> {
  try {
    const [row] = await db.update(departments).set(patch).where(eq(departments.id, id)).returning();
    if (!row) throw new AppError('NOT_FOUND', '所属が見つかりません', 404);
    return { id: row.id, name: row.name, sortOrder: row.sortOrder };
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError('CONFLICT', '同名の所属が既に存在します', 409);
    throw e;
  }
}

export async function deleteDepartment(db: Db, id: string): Promise<void> {
  const rows = await db.delete(departments).where(eq(departments.id, id)).returning({ id: departments.id });
  if (rows.length === 0) throw new AppError('NOT_FOUND', '所属が見つかりません', 404);
}

// ---- positions ----

export async function listPositions(db: Db): Promise<Master[]> {
  return db
    .select({ id: positions.id, name: positions.name, sortOrder: positions.sortOrder })
    .from(positions)
    .orderBy(asc(positions.sortOrder), asc(positions.name));
}

export async function createPosition(db: Db, name: string): Promise<Master> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${positions.sortOrder}), -1) + 1` })
    .from(positions);
  try {
    const [row] = await db.insert(positions).values({ name, sortOrder: next }).returning();
    return { id: row.id, name: row.name, sortOrder: row.sortOrder };
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError('CONFLICT', '同名の役職が既に存在します', 409);
    throw e;
  }
}

export async function updatePosition(
  db: Db,
  id: string,
  patch: { name?: string; sortOrder?: number },
): Promise<Master> {
  try {
    const [row] = await db.update(positions).set(patch).where(eq(positions.id, id)).returning();
    if (!row) throw new AppError('NOT_FOUND', '役職が見つかりません', 404);
    return { id: row.id, name: row.name, sortOrder: row.sortOrder };
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError('CONFLICT', '同名の役職が既に存在します', 409);
    throw e;
  }
}

export async function deletePosition(db: Db, id: string): Promise<void> {
  const rows = await db.delete(positions).where(eq(positions.id, id)).returning({ id: positions.id });
  if (rows.length === 0) throw new AppError('NOT_FOUND', '役職が見つかりません', 404);
}
