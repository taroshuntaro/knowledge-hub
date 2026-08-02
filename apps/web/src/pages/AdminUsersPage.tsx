import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { useMasters } from '../api/admin-masters';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar } from '@/components/Avatar';
import { RegistrationCodePanel } from '@/components/admin/RegistrationCodePanel';
import { AddUserForm } from '@/components/admin/AddUserForm';
import { UserCsvImports } from '@/components/admin/UserCsvImports';
import { errorMessage, NETWORK_ERROR_MESSAGE } from '../lib/api-error';

const selectClass = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm';

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
  // レンダーのたびに derive するだけにして常に live なリストと一致させる。
  const liveSelectedIds = selectedIds.filter((id) => (users ?? []).some((u) => u.id === id));

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
          'このユーザーは再クレームまでログインできず、名簿に表示されなくなります（記事等のコンテンツは残ります）。',
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

  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<{ line: number; email?: string; message: string }[]>([]);

  async function onImport(e: FormEvent) {
    e.preventDefault();
    setImportMsg(null);
    setImportErrors([]);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setImportMsg('CSV ファイルを選択してください');
      return;
    }
    try {
      const res = await api.api.admin.users.import.$post({ form: { file } });
      const body = await res.json();
      if (res.ok && 'updated' in body) {
        const created = [...(body.createdDepartments ?? []), ...(body.createdPositions ?? [])];
        setImportMsg(
          `${body.updated} 人を更新しました。` +
          (created.length > 0 ? `新規マスタ: ${created.join('、')}` : ''),
        );
        if (fileRef.current) fileRef.current.value = '';
        queryClient.invalidateQueries({ queryKey: keys.adminUsers });
        queryClient.invalidateQueries({ queryKey: keys.adminDepartments });
        queryClient.invalidateQueries({ queryKey: keys.adminPositions });
        queryClient.invalidateQueries({ queryKey: keys.profiles });
      } else if ('details' in body && Array.isArray(body.details)) {
        setImportMsg('message' in body ? String(body.message) : 'CSV にエラーがあります');
        setImportErrors(body.details as { line: number; email?: string; message: string }[]);
      } else {
        setImportMsg('message' in body ? String(body.message) : 'インポートに失敗しました');
      }
    } catch {
      setImportMsg(NETWORK_ERROR_MESSAGE);
    }
  }

  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">ユーザー管理</h2>
      <RegistrationCodePanel />
      <AddUserForm />
      <UserCsvImports />
      <Card className="mb-6">
        <CardHeader>
          <h3 className="leading-none font-semibold">所属・役職・入社年を CSV で一括設定</h3>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            ヘッダー行 email,department,position,hire_year の UTF-8 CSV。空欄は未設定に戻ります。
            未知の所属・役職は自動登録。エラーが 1 行でもあると何も適用されません。
          </p>
          <form onSubmit={onImport} className="flex items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="import-file">CSV ファイル</Label>
              <Input id="import-file" type="file" accept=".csv,text/csv" ref={fileRef} />
            </div>
            <Button type="submit">インポート</Button>
          </form>
          {importMsg && <p role="status" className="mt-3 text-sm text-muted-foreground">{importMsg}</p>}
          {importErrors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-destructive">
              {importErrors.map((e, i) => (
                <li key={i}>{e.line} 行目{e.email ? `（${e.email}）` : ''}: {e.message}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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
                  checked={liveSelectedIds.includes(u.id)}
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
