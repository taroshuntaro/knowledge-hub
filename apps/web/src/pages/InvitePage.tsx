import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.api.auth.invitations[':token'].accept.$post({
        param: { token: token ?? '' },
        json: { displayName, password },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? '登録に失敗しました');
        return;
      }
    } catch {
      setError('通信に失敗しました。時間をおいて再試行してください');
      return;
    }
    navigate('/');
  }

  return (
    <AuthShell title="アカウント登録">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="invite-name">表示名</Label>
          <Input id="invite-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={50} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="invite-password">パスワード（12文字以上）</Label>
          <Input id="invite-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit">登録する</Button>
      </form>
    </AuthShell>
  );
}
