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
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items) as ArticleItem[];
  if (q.isError) return <p className="text-destructive">読み込みに失敗しました。</p>;
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">#{name}</h2>
      <ArticleList items={items} hasMore={!!q.hasNextPage} onLoadMore={() => q.fetchNextPage()} />
    </section>
  );
}
