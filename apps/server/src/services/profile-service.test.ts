import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createDepartment, createPosition } from './master-service';
import { listProfiles } from './profile-service';

describe('profile service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('有効ユーザーのみを表示名順で返し、マスタも同梱する', async () => {
    const dep = await createDepartment(ctx.db, '開発部');
    const pos = await createPosition(ctx.db, '部長');
    await createTestUser(ctx.db, { displayName: 'いろは', departmentId: dep.id, positionId: pos.id, hireYear: 2018 });
    await createTestUser(ctx.db, { displayName: 'あいう' });
    await createTestUser(ctx.db, { displayName: '退職者', isActive: false });

    const res = await listProfiles(ctx.db);
    expect(res.users.map((u) => u.displayName)).toEqual(['あいう', 'いろは']);
    expect(res.users[1]).toMatchObject({
      department: { id: dep.id, name: '開発部' },
      position: { id: pos.id, name: '部長' },
      hireYear: 2018,
    });
    expect(res.users[0]).toMatchObject({ department: null, position: null, hireYear: null });
    expect(res.departments).toHaveLength(1);
    expect(res.positions).toHaveLength(1);
  });

  it('email など非公開情報を含めない', async () => {
    await createTestUser(ctx.db);
    const res = await listProfiles(ctx.db);
    expect(Object.keys(res.users[0]).sort()).toEqual(
      ['avatarUrl', 'bio', 'department', 'displayName', 'hireYear', 'id', 'position'].sort(),
    );
  });
});
