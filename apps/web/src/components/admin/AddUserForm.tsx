import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { keys } from '../../api/keys';
import { useMasters } from '../../api/admin-masters';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { selectClass } from '@/components/ui/select';
import { errorMessage, NETWORK_ERROR_MESSAGE } from '../../lib/api-error';

/**
 * ユーザーを未ログイン（pending）状態で個別に事前作成するフォーム。
 * 所属・役職・入社年は既存マスタ選択 UI（AdminUsersPage のテーブルと同じ）を流用し、
 * 未選択でも送信できる最小構成（PATCH で後から設定できるため必須にしない）。
 */
export function AddUserForm() {
  const queryClient = useQueryClient();
  const { data: departments } = useMasters('departments');
  const { data: positions } = useMasters('positions');

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [hireYear, setHireYear] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.api.admin.users.$post({
        json: {
          email,
          displayName,
          departmentId: departmentId || null,
          positionId: positionId || null,
          hireYear: hireYear === '' ? null : Number(hireYear),
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, '追加に失敗しました'));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.adminUsers });
      setEmail('');
      setDisplayName('');
      setDepartmentId('');
      setPositionId('');
      setHireYear('');
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await create.mutateAsync();
      setMessage('ユーザーを追加しました（未ログイン状態で登録されます）');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : NETWORK_ERROR_MESSAGE);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <h3 className="leading-none font-semibold">ユーザーを追加</h3>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          追加したユーザーは「未ログイン」状態で登録され、登録コードでのクレームまでログインできません。
        </p>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="add-user-email">メール</Label>
            <Input
              id="add-user-email" type="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-user-name">表示名</Label>
            <Input
              id="add-user-name" required
              value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-user-department">所属</Label>
            <select
              id="add-user-department" className={selectClass}
              value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">未設定</option>
              {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-user-position">役職</Label>
            <select
              id="add-user-position" className={selectClass}
              value={positionId} onChange={(e) => setPositionId(e.target.value)}
            >
              <option value="">未設定</option>
              {(positions ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-user-hire-year">入社年</Label>
            <Input
              id="add-user-hire-year" type="number" className="w-24"
              value={hireYear} onChange={(e) => setHireYear(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={create.isPending}>追加</Button>
        </form>
        {message && (
          <p
            role={create.isError ? 'alert' : 'status'}
            className={`mt-3 text-sm ${create.isError ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
