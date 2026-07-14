import { describe, expect, it } from 'vitest';
import { createMasterSchema, hireYearMax, hireYearSchema, updateMasterSchema } from './profile';
import { updateUserByAdminSchema } from './auth';

describe('profile schemas', () => {
  it('マスタ名は trim され、空は拒否', () => {
    expect(createMasterSchema.parse({ name: ' 開発部 ' })).toEqual({ name: '開発部' });
    expect(createMasterSchema.safeParse({ name: '  ' }).success).toBe(false);
  });

  it('updateMasterSchema は name / sortOrder どちらも無いと拒否', () => {
    expect(updateMasterSchema.safeParse({}).success).toBe(false);
    expect(updateMasterSchema.safeParse({ sortOrder: 3 }).success).toBe(true);
  });

  it('hireYear は 1950〜現在年+1 の整数のみ', () => {
    expect(hireYearSchema.safeParse(2020).success).toBe(true);
    expect(hireYearSchema.safeParse(hireYearMax()).success).toBe(true);
    expect(hireYearSchema.safeParse(hireYearMax() + 1).success).toBe(false);
    expect(hireYearSchema.safeParse(1949).success).toBe(false);
    expect(hireYearSchema.safeParse(2020.5).success).toBe(false);
  });

  it('updateUserByAdminSchema は組織項目だけでも通り、null クリアも可', () => {
    expect(updateUserByAdminSchema.safeParse({ hireYear: 2020 }).success).toBe(true);
    expect(updateUserByAdminSchema.safeParse({ departmentId: null, positionId: null, hireYear: null }).success).toBe(true);
    expect(updateUserByAdminSchema.safeParse({}).success).toBe(false);
    expect(updateUserByAdminSchema.safeParse({ departmentId: 'not-uuid' }).success).toBe(false);
  });
});
