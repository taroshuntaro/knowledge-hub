import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';

export function PasswordResetConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await api.api.auth['password-reset'].confirm[':token'].$post({
      param: { token: token ?? '' },
      json: { password },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? '再設定に失敗しました');
      return;
    }
    navigate('/login');
  }

  return (
    <main className="auth-page">
      <form onSubmit={onSubmit} className="auth-form">
        <h1>新しいパスワード</h1>
        <label>
          パスワード（12文字以上）
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit">パスワードを設定</button>
      </form>
    </main>
  );
}
