import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../api/client';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';

export function TagPage() {
  const { name = '' } = useParams();
  const q = useInfiniteQuery({
    queryKey: ['tag', name],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.tags[':name'].articles.$get({
        param: { name }, query: pageParam ? { cursor: pageParam } : {},
      });
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items) as ArticleItem[];
  return (
    <section>
      <h2>#{name}</h2>
      <ArticleList items={items} hasMore={!!q.hasNextPage} onLoadMore={() => q.fetchNextPage()} />
    </section>
  );
}
