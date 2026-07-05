import { Link, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useMe } from '../auth/useMe';

export function Layout() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function onLogout() {
    await api.api.auth.logout.$post();
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/login');
  }

  return (
    <div className="layout">
      <header className="header">
        <Link to="/" className="brand">knowledge-hub</Link>
        <nav>
          <Link to="/articles/new">記事を書く</Link>
          <Link to="/me/articles">マイ記事</Link>
          {me?.role === 'admin' && <Link to="/admin/categories">カテゴリ</Link>}
          {me?.role === 'admin' && <Link to="/admin">管理</Link>}
          <Link to="/settings">設定</Link>
          <span className="me">{me?.displayName}</span>
          <button type="button" onClick={onLogout}>ログアウト</button>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
