import { useState, type FormEvent } from 'react';
import { useMasterMutations, useMasters, type MasterKind } from '../api/admin-masters';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

function MasterSection({ kind, title }: { kind: MasterKind; title: string }) {
  const { data: items } = useMasters(kind);
  const { create, update, remove } = useMasterMutations(kind);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await create.mutateAsync(name);
      setName('');
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  function onRename(id: string, current: string) {
    const next = prompt(`${title}の新しい名称`, current);
    if (next && next.trim() && next !== current) {
      update.mutate({ id, name: next.trim() }, { onError: (e) => setMessage(e.message) });
    }
  }

  // 隣と sortOrder を入れ替えて並び順を 1 つ動かす
  function onMove(index: number, dir: -1 | 1) {
    const list = items ?? [];
    const a = list[index];
    const b = list[index + dir];
    if (!a || !b) return;
    update.mutate({ id: a.id, sortOrder: b.sortOrder }, { onError: (e) => setMessage(e.message) });
    update.mutate({ id: b.id, sortOrder: a.sortOrder }, { onError: (e) => setMessage(e.message) });
  }

  function onDelete(id: string, itemName: string) {
    if (confirm(`「${itemName}」を削除しますか？\n割り当て済みのユーザーは「未設定」に戻ります。`)) {
      remove.mutate(id, { onError: (e) => setMessage(e.message) });
    }
  }

  const inputId = `master-name-${kind}`;
  return (
    <Card className="mb-6" role="region" aria-label={title}>
      <CardHeader>
        <h3 className="leading-none font-semibold">{title}</h3>
      </CardHeader>
      <CardContent>
        <form onSubmit={onCreate} className="mb-4 flex items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>名称</Label>
            <Input id={inputId} value={name} onChange={(e) => setName(e.target.value)} required className="w-56" />
          </div>
          <Button type="submit">追加</Button>
        </form>
        {message && <p role="alert" className="mb-2 text-sm text-destructive">{message}</p>}
        <ul className="divide-y">
          {(items ?? []).map((item, i) => (
            <li key={item.id} className="flex items-center gap-2 py-2">
              <span className="flex-1">{item.name}</span>
              <Button type="button" variant="ghost" size="sm" aria-label={`${item.name} を上へ`}
                disabled={i === 0} onClick={() => onMove(i, -1)}>↑</Button>
              <Button type="button" variant="ghost" size="sm" aria-label={`${item.name} を下へ`}
                disabled={i === (items ?? []).length - 1} onClick={() => onMove(i, 1)}>↓</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onRename(item.id, item.name)}>改名</Button>
              <Button type="button" variant="outline" size="sm"
                className="border-destructive text-destructive hover:text-destructive"
                onClick={() => onDelete(item.id, item.name)}>削除</Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function AdminMastersPage() {
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">所属・役職マスタ</h2>
      <MasterSection kind="departments" title="所属" />
      <MasterSection kind="positions" title="役職" />
    </section>
  );
}
