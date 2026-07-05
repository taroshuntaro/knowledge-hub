import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export function useArticle(id: string) {
  return useQuery({
    queryKey: ['article', id],
    queryFn: async () => {
      const res = await api.api.articles[':id'].$get({ param: { id } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });
}
