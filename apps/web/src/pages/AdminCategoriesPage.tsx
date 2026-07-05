import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

type Node = { id: string; name: string; parentId: string | null; children: Node[] };

export function AdminCategoriesPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const { data: tree } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await api.api.categories.$get();
      return res.ok ? ((await res.json()) as Node[]) : [];
    },
  });
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
      <h2>カテゴリ管理</h2>
      <form onSubmit={onSubmit} className="auth-form">
        <label>名称<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>
          親カテゴリ
          <select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
            <option value="">（第1階層）</option>
            {(tree ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="submit">追加</button>
      </form>
      <ul>
        {(tree ?? []).map((p) => (
          <li key={p.id}>{p.name}
            {p.children.length > 0 && <ul>{p.children.map((c) => <li key={c.id}>{c.name}</li>)}</ul>}
          </li>
        ))}
      </ul>
    </section>
  );
}
