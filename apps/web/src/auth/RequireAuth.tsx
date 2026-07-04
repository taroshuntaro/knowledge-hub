import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMe } from './useMe';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <p className="loading">読み込み中…</p>;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
