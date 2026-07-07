import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const OIDC_ERRORS: Record<string, string> = {
  oidc_failed: 'SSO ログインに失敗しました。もう一度お試しください',
  oidc_domain: 'このメールドメインは許可されていません',
  oidc_inactive: 'このアカウントは無効化されています',
  oidc_email: 'メールアドレスを確認できませんでした',
  oidc_unavailable: 'SSO プロバイダに接続できません。しばらくしてから再試行してください',
};

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(() => {
    const code = searchParams.get('error');
    return code ? (OIDC_ERRORS[code] ?? null) : null;
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: methods, isLoading } = useQuery({
    queryKey: ['auth-methods'],
    queryFn: async () => {
      const res = await api.api.auth.methods.$get();
      if (!res.ok) throw new Error('failed to fetch auth methods');
      return res.json();
    },
  });
  const resolvedMethods = methods ?? { password: true, oidc: false };

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
    <AuthShell>
      {isLoading ? null : (
        <div className="flex flex-col gap-4">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {resolvedMethods.password && (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="login-email">メールアドレス</Label>
                <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="login-password">パスワード</Label>
                <Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <Button type="submit">ログイン</Button>
              <Link to="/password-reset" className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline">
                パスワードをお忘れですか？
              </Link>
            </form>
          )}
          {resolvedMethods.password && resolvedMethods.oidc && (
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">または</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          {resolvedMethods.oidc && (
            <Button asChild variant="outline">
              <a href="/api/auth/oidc/login">SSO でログイン</a>
            </Button>
          )}
        </div>
      )}
    </AuthShell>
  );
}
