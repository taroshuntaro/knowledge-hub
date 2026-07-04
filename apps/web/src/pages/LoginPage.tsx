import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await api.api.auth.login.$post({ json: { email, password } });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? 'ログインに失敗しました');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/');
  }

  return (
    <main className="auth-page">
      <form onSubmit={onSubmit} className="auth-form">
        <h1>knowledge-hub</h1>
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          パスワード
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit">ログイン</button>
        <Link to="/password-reset">パスワードをお忘れですか？</Link>
      </form>
    </main>
  );
}
