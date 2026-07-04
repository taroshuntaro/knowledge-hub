import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './auth/RequireAuth';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [{ path: '/', element: <HomePage /> }],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
