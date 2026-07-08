import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useCategories } from '../api/categories';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function AdminCategoriesPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const { data: tree } = useCategories();
  const create = useMutation({
    mutationFn: async () => {
      const res = await api.api.categories.$post({ json: { name, parentId } });
      if (!res.ok) throw new Error('作成に失敗しました');
    },
    onSuccess: () => { setName(''); queryClient.invalidateQueries({ queryKey: ['categories'] }); },
    onError: (e) => alert(e.message),
  });
  function onSubmit(e: FormEvent) { e.preventDefault(); create.mutate(); }
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">カテゴリ管理</h2>
      <Card>
        <CardHeader>
          <h3 className="leading-none font-semibold">カテゴリを追加</h3>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="admin-cat-name">名称</Label>
              <Input id="admin-cat-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="admin-cat-parent">親カテゴリ</Label>
              <select
                id="admin-cat-parent"
                value={parentId ?? ''}
                onChange={(e) => setParentId(e.target.value || null)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">（第1階層）</option>
                {(tree ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <Button type="submit">追加</Button>
          </form>
        </CardContent>
      </Card>
      <ul className="mt-6 space-y-2">
        {(tree ?? []).map((p) => (
          <li key={p.id} className="rounded-lg border bg-card px-4 py-3">
            <span className="font-medium">{p.name}</span>
            {p.children.length > 0 && (
              <ul className="mt-2 space-y-1 border-l pl-4">
                {p.children.map((c) => <li key={c.id} className="text-sm text-muted-foreground">{c.name}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
