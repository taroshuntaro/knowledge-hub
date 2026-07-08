import { useQuery } from '@tanstack/react-query';
import { api } from './client';

// GET /api/categories が返すカテゴリツリーの 1 ノード。各画面で個別に（しかも
// 微妙に異なる形で）宣言していたのを 1 つに統一する。
export type CategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  children: CategoryNode[];
};

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<CategoryNode[]> => {
      const res = await api.api.categories.$get();
      if (!res.ok) throw new Error('failed');
      return (await res.json()) as CategoryNode[];
    },
    // カテゴリはめったに変わらないので少しキャッシュを効かせる（旧 Sidebar の設定を踏襲）
    staleTime: 300_000,
  });
}
