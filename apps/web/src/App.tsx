import { lazy } from 'react';
import { createBrowserRouter, RouterProvider, useParams } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { AdminCategoriesPage } from './pages/AdminCategoriesPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { BookmarksPage } from './pages/BookmarksPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CategoryPage } from './pages/CategoryPage';
import { HomePage } from './pages/HomePage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { MyArticlesPage } from './pages/MyArticlesPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PasswordResetConfirmPage } from './pages/PasswordResetConfirmPage';
import { PasswordResetRequestPage } from './pages/PasswordResetRequestPage';
import { ProfilePage } from './pages/ProfilePage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TagPage } from './pages/TagPage';

// 重いエディタ（CodeMirror + Tiptap + lowlight）と記事詳細（Markdown パイプライン）は
// 初期バンドルから切り離し、開いたときにだけ読み込む（フィード/ログインを軽くする）。
const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })));
const ArticleDetailPage = lazy(() =>
  import('./pages/ArticleDetailPage').then((m) => ({ default: m.ArticleDetailPage })),
);

// /articles/new と /articles/:id/edit は同じ EditorPage を描画する。key を記事 id で
// 変えることで、記事間（new↔edit、別記事の edit↔edit）を SPA 遷移したときに必ず
// 再マウントさせ、内部の id/updatedAt などの state が前の記事のまま残るのを防ぐ。
function EditorRoute() {
  const { id } = useParams();
  return <EditorPage key={id ?? 'new'} />;
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/invite/:token', element: <InvitePage /> },
  { path: '/password-reset', element: <PasswordResetRequestPage /> },
  { path: '/password-reset/:token', element: <PasswordResetConfirmPage /> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/admin', element: <RequireRole role="admin"><AdminUsersPage /></RequireRole> },
      { path: '/articles/new', element: <EditorRoute /> },
      { path: '/articles/:id/edit', element: <EditorRoute /> },
      { path: '/articles/:id', element: <ArticleDetailPage /> },
      { path: '/categories', element: <CategoriesPage /> },
      { path: '/categories/:id', element: <CategoryPage /> },
      { path: '/tags/:name', element: <TagPage /> },
      { path: '/users/:id', element: <ProfilePage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/me/articles', element: <MyArticlesPage /> },
      { path: '/me/bookmarks', element: <BookmarksPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/admin/categories', element: <RequireRole role="admin"><AdminCategoriesPage /></RequireRole> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
