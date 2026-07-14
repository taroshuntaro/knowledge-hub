import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createDepartment, listDepartments, listPositions } from './master-service';
import { importUserOrg } from './user-import-service';

describe('user import service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('更新・空欄クリア・マスタ自動作成（既存は再利用）を行う', async () => {
    await createDepartment(ctx.db, '開発部'); // 既存マスタ → 再利用される
    const a = await createTestUser(ctx.db, { email: 'a@example.com', hireYear: 2000 });
    const b = await createTestUser(ctx.db, { email: 'b@example.com' });

    const csv = [
      'email,department,position,hire_year',
      'a@example.com,開発部,部長,2018',
      'b@example.com,,,',
    ].join('\n');
    const result = await importUserOrg(ctx.db, csv);
    expect(result).toEqual({
      ok: true, updated: 2, createdDepartments: [], createdPositions: ['部長'],
    });

    const [rowA] = await ctx.db.select().from(users).where(eq(users.id, a.id));
    expect(rowA.hireYear).toBe(2018);
    expect(rowA.departmentId).not.toBeNull();
    expect(rowA.positionId).not.toBeNull();
    const [rowB] = await ctx.db.select().from(users).where(eq(users.id, b.id));
    expect(rowB).toMatchObject({ departmentId: null, positionId: null, hireYear: null });
    expect(await listDepartments(ctx.db)).toHaveLength(1);
    expect(await listPositions(ctx.db)).toHaveLength(1);
  });

  it('1 行でもエラーがあれば何も適用しない（all-or-nothing）', async () => {
    const a = await createTestUser(ctx.db, { email: 'a@example.com' });
    const csv = [
      'email,department,position,hire_year',
      'a@example.com,開発部,,2018',
      'unknown@example.com,営業部,,2019',
      'a@example.com,,,abc',
    ].join('\n');
    const result = await importUserOrg(ctx.db, csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // 未知メール(3行目)・メール重複(4行目)。重複行は hire_year 検証前に打ち切るため 1 件のみ
    expect(result.errors.map((e) => e.line)).toEqual([3, 4]);

    const [rowA] = await ctx.db.select().from(users).where(eq(users.id, a.id));
    expect(rowA.departmentId).toBeNull();
    expect(await listDepartments(ctx.db)).toHaveLength(0);
  });

  it('ヘッダー不正・列数不一致・空 CSV を弾く', async () => {
    const bad = await importUserOrg(ctx.db, 'email,dept\nx@example.com,a');
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('unreachable');
    expect(bad.errors[0].line).toBe(1);

    const shortRow = await importUserOrg(
      ctx.db, 'email,department,position,hire_year\nx@example.com,a,b',
    );
    expect(shortRow.ok).toBe(false);

    const empty = await importUserOrg(ctx.db, '');
    expect(empty.ok).toBe(false);
  });
});
