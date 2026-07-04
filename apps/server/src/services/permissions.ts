import type { SessionUser } from '@knowledge-hub/shared';

// フェーズ2以降: 'article:edit' | 'article:delete' 等を追加し、resource 引数を導入する
export type Action = 'user:manage';

export function can(user: SessionUser, action: Action): boolean {
  switch (action) {
    case 'user:manage':
      return user.role === 'admin';
  }
}
