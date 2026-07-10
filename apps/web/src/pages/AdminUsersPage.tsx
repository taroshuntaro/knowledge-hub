import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar } from '@/components/Avatar';
import { errorMessage, NETWORK_ERROR_MESSAGE } from '../lib/api-error';

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const { data: users } = useQuery({
    queryKey: keys.adminUsers,
    queryFn: async () => {
      const res = await api.api.admin.users.$get();
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });

  const patchUser = useMutation({
    mutationFn: async (input: { id: string; role?: 'member' | 'admin'; isActive?: boolean }) => {
      const { id, ...json } = input;
      const res = await api.api.admin.users[':id'].$patch({ param: { id }, json });
      if (!res.ok) {
        throw new Error(await errorMessage(res, '更新に失敗しました'));
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.adminUsers }),
    onError: (e) => alert(e.message),
  });

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setInviteMsg(null);
    try {
      const res = await api.api.admin.users.invitations.$post({ json: { email: inviteEmail } });
      if (res.ok) {
        setInviteMsg(`${inviteEmail} に招待を送りました`);
        setInviteEmail('');
      } else {
        setInviteMsg(await errorMessage(res, '招待に失敗しました'));
      }
    } catch {
      setInviteMsg(NETWORK_ERROR_MESSAGE);
    }
  }

  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">ユーザー管理</h2>
      <Card className="mb-6">
        <CardHeader>
          <h3 className="leading-none font-semibold">ユーザーを招待</h3>
        </CardHeader>
        <CardContent>
          <form onSubmit={onInvite} className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="invite-email">招待するメールアドレス</Label>
              <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
            </div>
            {inviteMsg && <p role="status" className="text-sm text-muted-foreground">{inviteMsg}</p>}
            <Button type="submit">招待を送る</Button>
          </form>
        </CardContent>
      </Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>メール</TableHead>
            <TableHead>表示名</TableHead>
            <TableHead>ロール</TableHead>
            <TableHead>状態</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(users ?? []).map((u) => (
            <TableRow key={u.id} className="hover:bg-muted/50">
              <TableCell>{u.email}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar src={u.avatarUrl} name={u.displayName} className="size-6 text-xs" />
                  {u.displayName}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role === 'admin' ? '管理者' : 'メンバー'}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={u.isActive ? 'secondary' : 'outline'}>{u.isActive ? '有効' : '無効'}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => patchUser.mutate({ id: u.id, role: u.role === 'admin' ? 'member' : 'admin' })}
                  >
                    {u.role === 'admin' ? 'メンバーにする' : '管理者にする'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={u.isActive ? 'border-destructive text-destructive hover:text-destructive' : undefined}
                    onClick={() => patchUser.mutate({ id: u.id, isActive: !u.isActive })}
                  >
                    {u.isActive ? '無効化' : '有効化'}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
