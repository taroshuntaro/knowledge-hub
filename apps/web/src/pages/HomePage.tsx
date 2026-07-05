import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api/client';
import { ArticleCard, type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';

export function HomePage() {
  const pickup = useQuery({
    queryKey: ['pickup'],
    queryFn: async () => {
      const res = await api.api.articles.pickup.$get();
      if (!res.ok) throw new Error('failed');
      return (await res.json()) as ArticleItem[];
    },
  });
  const feed = useInfiniteQuery({
    queryKey: ['feed'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.articles.$get({ query: pageParam ? { cursor: pageParam } : {} });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (feed.data?.pages ?? []).flatMap((p) => p.items) as ArticleItem[];

  if (feed.isError || pickup.isError) return <p>読み込みに失敗しました。</p>;

  return (
    <div>
      <Link to="/articles/new" className="primary-link">記事を書く</Link>
      {(pickup.data ?? []).length > 0 && (
        <section>
          <h2>ピックアップ</h2>
          <div className="article-list">
            {pickup.data!.map((it) => <ArticleCard key={it.id} item={it} />)}
          </div>
        </section>
      )}
      <section>
        <h2>新着</h2>
        <ArticleList items={items} hasMore={!!feed.hasNextPage} onLoadMore={() => feed.fetchNextPage()} />
      </section>
    </div>
  );
}
