import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { useMasters } from '../api/admin-masters';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { selectClass } from '@/components/ui/select';
import { Avatar } from '@/components/Avatar';
import { RegistrationCodePanel } from '@/components/admin/RegistrationCodePanel';
import { AddUserForm } from '@/components/admin/AddUserForm';
import {
  CsvImportCard, UserCsvImports, createdMastersSuffix, type ImportResult,
} from '@/components/admin/UserCsvImports';
import { errorMessage, importErrorBody } from '../lib/api-error';

export function AdminUsersPage() {
  const queryClient = useQueryClient();

  const { data: users } = useQuery({
    queryKey: keys.adminUsers,
    queryFn: async () => {
      const res = await api.api.admin.users.$get();
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });

  const { data: departments } = useMasters('departments');
  const { data: positions } = useMasters('positions');

  const patchUser = useMutation({
    mutationFn: async (input: {
      id: string;
      role?: 'member' | 'admin';
      isActive?: boolean;
      departmentId?: string | null;
      positionId?: string | null;
      hireYear?: number | null;
    }) => {
      const { id, ...json } = input;
      const res = await api.api.admin.users[':id'].$patch({ param: { id }, json });
      if (!res.ok) {
        throw new Error(await errorMessage(res, '更新に失敗しました'));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.adminUsers });
      queryClient.invalidateQueries({ queryKey: keys.profiles });
    },
    onError: (e) => alert(e.message),
  });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // users から消えた（削除済み等の）id を選択状態から取り除いた派生値。
  // useEffect でプルーニングすると useQuery の refetch タイミングとの同期漏れが起きうるため、
  // derive するだけにして常に live なリストと一致させる（Set 化は行数×選択数の線形化のため）。
  const userIds = useMemo(() => new Set((users ?? []).map((u) => u.id)), [users]);
  const liveSelectedIds = useMemo(
    () => selectedIds.filter((id) => userIds.has(id)),
    [selectedIds, userIds],
  );
  const selectedSet = useMemo(() => new Set(liveSelectedIds), [liveSelectedIds]);

  const deactivateSelected = useMutation({
    mutationFn: async (userIds: string[]) => {
      const res = await api.api.admin.users.deactivate.$post({ json: { userIds } });
      if (!res.ok) throw new Error(await errorMessage(res, '無効化に失敗しました'));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.adminUsers });
      queryClient.invalidateQueries({ queryKey: keys.profiles });
      setSelectedIds([]);
    },
    onError: (e) => alert(e.message),
  });

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.api.admin.users[':id'].$delete({ param: { id } });
      if (!res.ok) throw new Error(await errorMessage(res, '削除に失敗しました'));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.adminUsers }),
    onError: (e) => alert(e.message),
  });

  const unclaimUser = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.api.admin.users[':id'].unclaim.$post({ param: { id } });
      if (!res.ok) throw new Error(await errorMessage(res, '未ログインへの変更に失敗しました'));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.adminUsers });
      queryClient.invalidateQueries({ queryKey: keys.profiles });
    },
    onError: (e) => alert(e.message),
  });

  function onDeactivateSelected() {
    if (liveSelectedIds.length === 0) return;
    if (!confirm(`選択した ${liveSelectedIds.length} 人を無効化しますか？`)) return;
    deactivateSelected.mutate(liveSelectedIds);
  }

  function onDeletePending(u: { id: string; displayName: string }) {
    if (confirm(`「${u.displayName}」を削除しますか？未ログインのユーザーのみ削除できます。`)) {
      deleteUser.mutate(u.id);
    }
  }

  function onUnclaim(u: { id: string; displayName: string }) {
    if (
      confirm(
        `「${u.displayName}」を未ログインに戻しますか？\n` +
          'このユーザーは再クレームまでログインできず、名簿に表示されなくなります（記事等のコンテンツは残ります）。' +
          '管理者は member に戻ります。',
      )
    ) {
      unclaimUser.mutate(u.id);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const allSelected = (users ?? []).length > 0 && liveSelectedIds.length === (users ?? []).length;
  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : (users ?? []).map((u) => u.id));
  }

  async function submitOrgImport(file: File): Promise<ImportResult> {
    const res = await api.api.admin.users.import.$post({ form: { file } });
    const body = await res.json();
    if (res.ok && 'updated' in body) {
      queryClient.invalidateQueries({ queryKey: keys.adminUsers });
      queryClient.invalidateQueries({ queryKey: keys.adminDepartments });
      queryClient.invalidateQueries({ queryKey: keys.adminPositions });
      queryClient.invalidateQueries({ queryKey: keys.profiles });
      return { ok: true, message: `${body.updated} 人を更新しました。${createdMastersSuffix(body)}` };
    }
    const { message, details } = importErrorBody(body, 'インポートに失敗しました');
    return { ok: false, message, details };
  }

  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">ユーザー管理</h2>
      <RegistrationCodePanel />
      <AddUserForm />
      <UserCsvImports />
      <CsvImportCard
        id="import-file"
        title="所属・役職・入社年を CSV で一括設定"
        description="ヘッダー行 email,department,position,hire_year の UTF-8 CSV。空欄は未設定に戻ります。未知の所属・役職は自動登録。エラーが 1 行でもあると何も適用されません。"
        fileLabel="CSV ファイル"
        buttonLabel="インポート"
        submit={submitOrgImport}
      />
      <div className="mb-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-destructive text-destructive hover:text-destructive"
          disabled={liveSelectedIds.length === 0 || deactivateSelected.isPending}
          onClick={onDeactivateSelected}
        >
          選択したユーザーを無効化
        </Button>
        {liveSelectedIds.length > 0 && (
          <span className="text-sm text-muted-foreground">{liveSelectedIds.length} 人選択中</span>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <input
                type="checkbox"
                aria-label="全員を選択"
                checked={allSelected}
                onChange={toggleSelectAll}
              />
            </TableHead>
            <TableHead>メール</TableHead>
            <TableHead>表示名</TableHead>
            <TableHead>ロール</TableHead>
            <TableHead>状態</TableHead>
            <TableHead>所属</TableHead>
            <TableHead>役職</TableHead>
            <TableHead>入社年</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(users ?? []).map((u) => (
            <TableRow key={u.id} className="hover:bg-muted/50">
              <TableCell>
                <input
                  type="checkbox"
                  aria-label={`${u.displayName} を選択`}
                  checked={selectedSet.has(u.id)}
                  onChange={() => toggleSelected(u.id)}
                />
              </TableCell>
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
                <div className="flex flex-wrap gap-1">
                  <Badge variant={u.isActive ? 'secondary' : 'outline'}>{u.isActive ? '有効' : '無効'}</Badge>
                  {u.authProvider === 'pending' && <Badge variant="outline">未ログイン</Badge>}
                </div>
              </TableCell>
              <TableCell>
                <select aria-label={`${u.displayName} の所属`} className={selectClass}
                  value={u.departmentId ?? ''}
                  onChange={(e) => patchUser.mutate({ id: u.id, departmentId: e.target.value || null })}>
                  <option value="">未設定</option>
                  {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </TableCell>
              <TableCell>
                <select aria-label={`${u.displayName} の役職`} className={selectClass}
                  value={u.positionId ?? ''}
                  onChange={(e) => patchUser.mutate({ id: u.id, positionId: e.target.value || null })}>
                  <option value="">未設定</option>
                  {(positions ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </TableCell>
              <TableCell>
                <Input
                  key={`${u.id}-${u.hireYear}`}
                  aria-label={`${u.displayName} の入社年`}
                  type="number" className="w-24" defaultValue={u.hireYear ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    if (v !== u.hireYear) patchUser.mutate({ id: u.id, hireYear: v });
                  }}
                />
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={u.authProvider === 'pending'}
                    title={u.authProvider === 'pending' ? '未ログインのユーザーは管理者にできません' : undefined}
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
                  {u.authProvider === 'pending' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${u.displayName} を削除`}
                      className="border-destructive text-destructive hover:text-destructive"
                      onClick={() => onDeletePending(u)}
                    >
                      削除
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${u.displayName} を未ログインに戻す`}
                      className="border-destructive text-destructive hover:text-destructive"
                      onClick={() => onUnclaim(u)}
                    >
                      未ログインに戻す
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
