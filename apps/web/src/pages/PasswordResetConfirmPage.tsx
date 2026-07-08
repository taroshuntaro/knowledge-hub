import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '../lib/api-error';

export function PasswordResetConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.api.auth['password-reset'].confirm[':token'].$post({
        param: { token: token ?? '' },
        json: { password },
      });
      if (!res.ok) {
        setError(await errorMessage(res, '再設定に失敗しました'));
        return;
      }
    } catch {
      setError('通信に失敗しました。時間をおいて再試行してください');
      return;
    }
    navigate('/login');
  }

  return (
    <AuthShell title="新しいパスワード">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="new-password">パスワード（12文字以上）</Label>
          <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit">パスワードを設定</Button>
      </form>
    </AuthShell>
  );
}
