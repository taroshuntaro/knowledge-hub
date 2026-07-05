import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

type Node = { id: string; name: string; children: Node[] };

export function CategorySelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await api.api.categories.$get();
      return res.ok ? ((await res.json()) as Node[]) : [];
    },
  });
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">（カテゴリ未設定）</option>
      {(data ?? []).map((parent) => (
        <optgroup key={parent.id} label={parent.name}>
          <option value={parent.id}>{parent.name}</option>
          {parent.children.map((child) => (
            <option key={child.id} value={child.id}>　{child.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
