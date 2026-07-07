import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './auth/RequireAuth';
import { AdminCategoriesPage } from './pages/AdminCategoriesPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { ArticleDetailPage } from './pages/ArticleDetailPage';
import { BookmarksPage } from './pages/BookmarksPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CategoryPage } from './pages/CategoryPage';
import { EditorPage } from './pages/EditorPage';
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
      { path: '/admin', element: <AdminUsersPage /> },
      { path: '/articles/new', element: <EditorPage /> },
      { path: '/articles/:id/edit', element: <EditorPage /> },
      { path: '/articles/:id', element: <ArticleDetailPage /> },
      { path: '/categories', element: <CategoriesPage /> },
      { path: '/categories/:id', element: <CategoryPage /> },
      { path: '/tags/:name', element: <TagPage /> },
      { path: '/users/:id', element: <ProfilePage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/me/articles', element: <MyArticlesPage /> },
      { path: '/me/bookmarks', element: <BookmarksPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/admin/categories', element: <AdminCategoriesPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
