import type { SessionUser } from '@knowledge-hub/shared';

export type Action =
  | 'user:manage'
  | 'article:create'
  | 'article:edit'
  | 'article:delete'
  | 'article:pin'
  | 'category:manage';

export function can(
  user: SessionUser,
  action: Action,
  resource?: { authorId?: string },
): boolean {
  switch (action) {
    case 'user:manage':
    case 'article:pin':
    case 'category:manage':
      return user.role === 'admin';
    case 'article:create':
      return true;
    case 'article:edit':
    case 'article:delete':
      return user.role === 'admin' || resource?.authorId === user.id;
  }
}
