import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

type Node = { id: string; name: string; children: Node[] };

export function CategorySelect({ value, onChange, id }: { value: string | null; onChange: (v: string | null) => void; id?: string }) {
  const { data } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await api.api.categories.$get();
      return res.ok ? ((await res.json()) as Node[]) : [];
    },
  });
  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
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
