import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const { data: users } = useQuery({
    queryKey: ['admin-users'],
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
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? '更新に失敗しました');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e) => alert(e.message),
  });

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setInviteMsg(null);
    const res = await api.api.admin.users.invitations.$post({ json: { email: inviteEmail } });
    if (res.ok) {
      setInviteMsg(`${inviteEmail} に招待を送りました`);
      setInviteEmail('');
    } else {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setInviteMsg(body?.message ?? '招待に失敗しました');
    }
  }

  return (
    <section>
      <h2>ユーザー管理</h2>
      <form onSubmit={onInvite} className="auth-form">
        <label>
          招待するメールアドレス
          <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
        </label>
        {inviteMsg && <p role="status">{inviteMsg}</p>}
        <button type="submit">招待を送る</button>
      </form>
      <table>
        <thead>
          <tr><th>メール</th><th>表示名</th><th>ロール</th><th>状態</th><th>操作</th></tr>
        </thead>
        <tbody>
          {(users ?? []).map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.displayName}</td>
              <td>{u.role === 'admin' ? '管理者' : 'メンバー'}</td>
              <td>{u.isActive ? '有効' : '無効'}</td>
              <td>
                <button type="button" onClick={() => patchUser.mutate({ id: u.id, role: u.role === 'admin' ? 'member' : 'admin' })}>
                  {u.role === 'admin' ? 'メンバーにする' : '管理者にする'}
                </button>{' '}
                <button type="button" onClick={() => patchUser.mutate({ id: u.id, isActive: !u.isActive })}>
                  {u.isActive ? '無効化' : '有効化'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
