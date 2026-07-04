import { useState, type FormEvent } from 'react';
import { api } from '../api/client';

export function PasswordResetRequestPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await api.api.auth['password-reset'].request.$post({ json: { email } });
    setDone(true);
  }

  if (done) {
    return (
      <main className="auth-page">
        <p>登録されているメールアドレスであれば、再設定用のリンクを送信しました。メールをご確認ください。</p>
      </main>
    );
  }
  return (
    <main className="auth-page">
      <form onSubmit={onSubmit} className="auth-form">
        <h1>パスワード再設定</h1>
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button type="submit">再設定リンクを送る</button>
      </form>
    </main>
  );
}
