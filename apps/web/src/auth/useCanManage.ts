import { useMe } from './useMe';

/**
 * 「対象の作成者本人 or 管理者」の Web 側判定（記事管理・コメント削除で共通）。
 * 真の認可境界はサーバー（permissions.ts の can()）で、これは表示制御用。
 */
export function useCanManage(authorId: string | undefined): boolean {
  const { data: me } = useMe();
  return Boolean(me && authorId && (me.role === 'admin' || me.id === authorId));
}
