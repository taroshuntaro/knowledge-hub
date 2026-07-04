import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await api.api.auth.invitations[':token'].accept.$post({
      param: { token: token ?? '' },
      json: { displayName, password },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? '登録に失敗しました');
      return;
    }
    navigate('/');
  }

  return (
    <main className="auth-page">
      <form onSubmit={onSubmit} className="auth-form">
        <h1>アカウント登録</h1>
        <label>
          表示名
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={50} />
        </label>
        <label>
          パスワード（12文字以上）
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit">登録する</button>
      </form>
    </main>
  );
}
