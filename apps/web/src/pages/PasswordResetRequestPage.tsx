import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { NETWORK_ERROR_MESSAGE } from '../lib/api-error';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PasswordResetRequestPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.api.auth['password-reset'].request.$post({ json: { email } });
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <AuthShell title="パスワード再設定">
        <p className="text-sm leading-relaxed text-muted-foreground">
          登録されているメールアドレスであれば、再設定用のリンクを送信しました。メールをご確認ください。
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="パスワード再設定">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="grid gap-1.5">
          <Label htmlFor="reset-email">メールアドレス</Label>
          <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <Button type="submit">再設定リンクを送る</Button>
      </form>
    </AuthShell>
  );
}
