import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './auth/RequireAuth';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { ArticleDetailPage } from './pages/ArticleDetailPage';
import { CategoryPage } from './pages/CategoryPage';
import { HomePage } from './pages/HomePage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { MyArticlesPage } from './pages/MyArticlesPage';
import { PasswordResetConfirmPage } from './pages/PasswordResetConfirmPage';
import { PasswordResetRequestPage } from './pages/PasswordResetRequestPage';
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
      { path: '/articles/:id', element: <ArticleDetailPage /> },
      { path: '/categories/:id', element: <CategoryPage /> },
      { path: '/tags/:name', element: <TagPage /> },
      { path: '/me/articles', element: <MyArticlesPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
