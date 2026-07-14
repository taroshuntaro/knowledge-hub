import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createDepartment, createPosition, deleteDepartment, listDepartments, updateDepartment,
} from './master-service';

describe('master service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('作成すると sortOrder は末尾に採番され、sortOrder→name 順で返す', async () => {
    const a = await createDepartment(ctx.db, '開発部');
    const b = await createDepartment(ctx.db, '営業部');
    expect(a.sortOrder).toBe(0);
    expect(b.sortOrder).toBe(1);
    await updateDepartment(ctx.db, b.id, { sortOrder: 0 });
    const list = await listDepartments(ctx.db);
    expect(list.map((d) => d.name)).toEqual(['営業部', '開発部']);
  });

  it('同名の作成・改名は CONFLICT', async () => {
    await createDepartment(ctx.db, '開発部');
    await expect(createDepartment(ctx.db, '開発部')).rejects.toMatchObject({ code: 'CONFLICT' });
    const b = await createDepartment(ctx.db, '営業部');
    await expect(updateDepartment(ctx.db, b.id, { name: '開発部' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('削除すると割当済みユーザーの departmentId は null に戻る', async () => {
    const dep = await createDepartment(ctx.db, '開発部');
    const user = await createTestUser(ctx.db, { departmentId: dep.id });
    await deleteDepartment(ctx.db, dep.id);
    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(row.departmentId).toBeNull();
  });

  it('存在しない id の更新・削除は NOT_FOUND', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    await expect(updateDepartment(ctx.db, missing, { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteDepartment(ctx.db, missing)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('positions も同じ挙動（作成の採番）', async () => {
    const p = await createPosition(ctx.db, '部長');
    expect(p).toMatchObject({ name: '部長', sortOrder: 0 });
  });
});
