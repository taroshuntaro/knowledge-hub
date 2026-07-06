import { describe, expect, it } from 'vitest';
import { acceptInvitationSchema, loginSchema, updateProfileSchema } from './auth';

describe('auth schemas', () => {
  it('loginSchema は正しい入力を受理する', () => {
    expect(loginSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true);
  });
  it('acceptInvitationSchema は 11 文字のパスワードを拒否する', () => {
    const r = acceptInvitationSchema.safeParse({ displayName: '太郎', password: 'a'.repeat(11) });
    expect(r.success).toBe(false);
  });
  it('acceptInvitationSchema は 12 文字のパスワードを受理する', () => {
    const r = acceptInvitationSchema.safeParse({ displayName: '太郎', password: 'a'.repeat(12) });
    expect(r.success).toBe(true);
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
