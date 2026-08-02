import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage, NETWORK_ERROR_MESSAGE } from '../lib/api-error';

export function ClaimPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.api.auth.claim.$post({ json: { email, code, password } });
      if (!res.ok) {
        setError(await errorMessage(res, '登録に失敗しました'));
        return;
      }
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: keys.me });
    navigate('/');
  }

  return (
    <AuthShell title="アカウント登録">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="claim-email">メールアドレス</Label>
          <Input
            id="claim-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="claim-code">登録コード</Label>
          <Input id="claim-code" value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="claim-password">パスワード（12文字以上）</Label>
          <Input
            id="claim-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit">登録する</Button>
      </form>
    </AuthShell>
  );
}
