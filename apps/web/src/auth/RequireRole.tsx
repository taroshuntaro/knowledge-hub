import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMe } from './useMe';

// 管理者専用ルートの認可を「サイドバーのリンクを隠す」だけに頼らず、ルーティング層で
// 明示的に行う。member が /admin へ直リンクしても壊れた admin シェルを描画せず、
// フィードへリダイレクトする（認証は RequireAuth、認可はこのガードが担う）。
export function RequireRole({ role, children }: { role: 'admin'; children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <p className="p-8 text-center text-muted-foreground">読み込み中…</p>;
  if (!me) return <Navigate to="/login" replace />;
  if (me.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}
