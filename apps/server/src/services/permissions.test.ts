import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { can } from './permissions';

const user = (role: 'member' | 'admin'): SessionUser => ({
  id: '1', email: 'a@example.com', displayName: 'A', role, avatarUrl: null, bio: '', authProvider: 'password',
});

describe('can', () => {
  it('admin は user:manage できる', () => {
    expect(can(user('admin'), 'user:manage')).toBe(true);
  });
  it('member は user:manage できない', () => {
    expect(can(user('member'), 'user:manage')).toBe(false);
  });
  it('member は記事を作成できる', () => {
    expect(can(user('member'), 'article:create')).toBe(true);
  });
  it('member は自分の記事のみ編集できる', () => {
    expect(can(user('member'), 'article:edit', { authorId: '1' })).toBe(true);
    expect(can(user('member'), 'article:edit', { authorId: '2' })).toBe(false);
  });
  it('admin は他人の記事も削除できる', () => {
    expect(can(user('admin'), 'article:delete', { authorId: '2' })).toBe(true);
  });
  it('member はピン留め・カテゴリ管理できない', () => {
    expect(can(user('member'), 'article:pin')).toBe(false);
    expect(can(user('member'), 'category:manage')).toBe(false);
  });
  it('コメント編集は作成者のみ（admin でも他人のコメントは不可）', () => {
    expect(can(user('member'), 'comment:edit', { authorId: '1' })).toBe(true);
    expect(can(user('member'), 'comment:edit', { authorId: '2' })).toBe(false);
    expect(can(user('admin'), 'comment:edit', { authorId: '2' })).toBe(false);
  });
  it('コメント削除は作成者または admin', () => {
    expect(can(user('member'), 'comment:delete', { authorId: '1' })).toBe(true);
    expect(can(user('member'), 'comment:delete', { authorId: '2' })).toBe(false);
    expect(can(user('admin'), 'comment:delete', { authorId: '2' })).toBe(true);
  });
});
