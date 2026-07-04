import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.api.auth.me.$get();
      if (res.status === 401) return null;
      if (!res.ok) throw new Error('failed to fetch me');
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });
}
