import { describe, expect, it } from 'vitest';
import { acceptInvitationSchema, loginSchema } from './auth';

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
});
