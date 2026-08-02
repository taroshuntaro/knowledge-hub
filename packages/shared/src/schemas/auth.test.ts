import { describe, expect, it } from 'vitest';
import { adminCreateUserSchema, claimSchema, deactivateUsersSchema, issueRegistrationCodeSchema, loginSchema, updateProfileSchema } from './auth';

describe('auth schemas', () => {
  it('loginSchema は正しい入力を受理する', () => {
    expect(loginSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true);
  });
  it('updateProfileSchema は /api/uploads/<uuid> 形式の avatarUrl を受理する', () => {
    const r = updateProfileSchema.safeParse({
      displayName: '太郎',
      bio: '',
      avatarUrl: '/api/uploads/123e4567-e89b-12d3-a456-426614174000',
    });
    expect(r.success).toBe(true);
  });

  it('updateProfileSchema は外部 URL の avatarUrl を拒否する', () => {
    const r = updateProfileSchema.safeParse({
      displayName: '太郎',
      bio: '',
      avatarUrl: 'https://evil.example/x.png',
    });
    expect(r.success).toBe(false);
  });

  it('updateProfileSchema は正規 URL を部分文字列として含む avatarUrl を拒否する（アンカー回帰）', () => {
    // 末尾に余分な文字があるケース（$ アンカーがないと通ってしまう）
    expect(
      updateProfileSchema.safeParse({
        displayName: '太郎',
        bio: '',
        avatarUrl: '/api/uploads/123e4567-e89b-12d3-a456-426614174000/extra',
      }).success,
    ).toBe(false);
    // 外部 URL の後ろに正規サフィックスを埋め込んだケース（^ アンカーがないと通ってしまう）
    expect(
      updateProfileSchema.safeParse({
        displayName: '太郎',
        bio: '',
        avatarUrl:
          'https://evil.example/x.png/api/uploads/123e4567-e89b-12d3-a456-426614174000',
      }).success,
    ).toBe(false);
  });

  it('updateProfileSchema は avatarUrl: null を受理する（削除）', () => {
    const r = updateProfileSchema.safeParse({
      displayName: '太郎',
      bio: '',
      avatarUrl: null,
    });
    expect(r.success).toBe(true);
  });
});

describe('account lifecycle schemas', () => {
  it('claimSchema は email+code+password(12+) を受理する', () => {
    expect(claimSchema.safeParse({ email: 'a@example.com', code: 'ABCD-EFGH-JKMN-PQRS', password: 'a'.repeat(12) }).success).toBe(true);
  });
  it('claimSchema は 11 文字パスワードを拒否する', () => {
    expect(claimSchema.safeParse({ email: 'a@example.com', code: 'X', password: 'a'.repeat(11) }).success).toBe(false);
  });
  it('issueRegistrationCodeSchema は 7/30/90 のみ受理する', () => {
    expect(issueRegistrationCodeSchema.safeParse({ expiresInDays: 30 }).success).toBe(true);
    expect(issueRegistrationCodeSchema.safeParse({ expiresInDays: 14 }).success).toBe(false);
  });
  it('adminCreateUserSchema は email+displayName 必須', () => {
    expect(adminCreateUserSchema.safeParse({ email: 'a@example.com', displayName: '太郎' }).success).toBe(true);
    expect(adminCreateUserSchema.safeParse({ email: 'a@example.com' }).success).toBe(false);
  });
  it('deactivateUsersSchema は空配列を拒否する', () => {
    expect(deactivateUsersSchema.safeParse({ userIds: [] }).success).toBe(false);
  });
});
