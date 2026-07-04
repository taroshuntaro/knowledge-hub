import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { can } from './permissions';

const user = (role: 'member' | 'admin'): SessionUser => ({
  id: '1', email: 'a@example.com', displayName: 'A', role, avatarUrl: null, bio: '',
});

describe('can', () => {
  it('admin は user:manage できる', () => {
    expect(can(user('admin'), 'user:manage')).toBe(true);
  });
  it('member は user:manage できない', () => {
    expect(can(user('member'), 'user:manage')).toBe(false);
  });
});
