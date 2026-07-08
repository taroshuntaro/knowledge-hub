import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMe } from './useMe';
import { RequireAuth } from './RequireAuth';

// 認証（ローディング表示・未ログイン時の /login リダイレクト）は RequireAuth に委譲し、
// このコンポーネントはロール判定だけを上乗せする。member が /admin へ直リンクしても
// 壊れた admin シェルを描画せずフィードへリダイレクトする。
export function RequireRole({ role, children }: { role: 'admin'; children: ReactNode }) {
  return (
    <RequireAuth>
      <RoleGate role={role}>{children}</RoleGate>
    </RequireAuth>
  );
}

function RoleGate({ role, children }: { role: 'admin'; children: ReactNode }) {
  // RequireAuth 通過後なので me は存在する（useMe は react-query でキャッシュ共有）。
  const { data: me } = useMe();
  if (me && me.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}
