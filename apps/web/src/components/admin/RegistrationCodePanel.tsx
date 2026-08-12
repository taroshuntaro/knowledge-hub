import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { keys } from '../../api/keys';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { selectClass } from '@/components/ui/select';
import { errorMessage, NETWORK_ERROR_MESSAGE } from '../../lib/api-error';
import { formatDate } from '../../lib/date';

/**
 * 登録コードの発行・失効パネル。平文コードは発行レスポンスにしか含まれないため、
 * 発行直後だけローカル state に保持して 1 回だけ表示する（refetch や再訪問では復元されない）。
 */
export function RegistrationCodePanel() {
  const queryClient = useQueryClient();

  const { data: meta } = useQuery({
    queryKey: keys.registrationCode,
    queryFn: async () => {
      const res = await api.api.admin['registration-code'].$get();
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });

  const [expiresInDays, setExpiresInDays] = useState<7 | 30 | 90>(30);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: async () => {
      const res = await api.api.admin['registration-code'].$post({ json: { expiresInDays } });
      if (!res.ok) throw new Error(await errorMessage(res, 'コードの発行に失敗しました'));
      return res.json();
    },
    onSuccess: (body) => {
      setIssuedCode(body.code);
      queryClient.invalidateQueries({ queryKey: keys.registrationCode });
    },
  });

  const revoke = useMutation({
    mutationFn: async () => {
      const res = await api.api.admin['registration-code'].$delete();
      if (!res.ok) throw new Error(await errorMessage(res, '失効に失敗しました'));
    },
    onSuccess: () => {
      setIssuedCode(null);
      queryClient.invalidateQueries({ queryKey: keys.registrationCode });
    },
  });

  async function onIssue() {
    setMessage(null);
    try {
      await issue.mutateAsync();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : NETWORK_ERROR_MESSAGE);
    }
  }

  async function onRevoke() {
    if (!confirm('登録コードを失効させますか？未クレームのユーザーは新しいコードが必要になります。')) return;
    setMessage(null);
    try {
      await revoke.mutateAsync();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : NETWORK_ERROR_MESSAGE);
    }
  }

  return (
    <Card className="mb-6" role="region" aria-label="登録コード">
      <CardHeader>
        <h3 className="leading-none font-semibold">登録コード</h3>
      </CardHeader>
      <CardContent>
        {meta ? (
          <p className="mb-3 text-sm text-muted-foreground">
            有効期限: {formatDate(meta.expiresAt)}（発行日時: {formatDate(meta.createdAt)}）
          </p>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">有効なコードはありません</p>
        )}
        <div className="flex items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="reg-code-expires">有効期限</Label>
            <select
              id="reg-code-expires"
              className={selectClass}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value) as 7 | 30 | 90)}
            >
              <option value={7}>7日</option>
              <option value={30}>30日</option>
              <option value={90}>90日</option>
            </select>
          </div>
          <Button type="button" onClick={onIssue} disabled={issue.isPending}>発行</Button>
          {meta && (
            <Button
              type="button"
              variant="outline"
              className="border-destructive text-destructive hover:text-destructive"
              onClick={onRevoke}
              disabled={revoke.isPending}
            >
              失効
            </Button>
          )}
        </div>
        {message && <p role="alert" className="mt-2 text-sm text-destructive">{message}</p>}
        {issuedCode && (
          <div className="mt-3 rounded-md border border-dashed p-3">
            <p className="mb-1 text-sm font-medium">発行されたコード</p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                aria-label="発行された登録コード"
                value={issuedCode}
                className="font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard?.writeText(issuedCode).catch(() => {})}
              >
                コピー
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              このコードは再表示できません。今すぐ控えてください。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
