import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
    <AuthShell title="knowledge-hub">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="login-email">メールアドレス</Label>
          <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="login-password">パスワード</Label>
          <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit">ログイン</Button>
        <Link to="/password-reset" className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline">
          パスワードをお忘れですか？
        </Link>
      </form>
    </AuthShell>
  );
}
