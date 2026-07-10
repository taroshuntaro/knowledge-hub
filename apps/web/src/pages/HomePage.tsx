import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Pin } from 'lucide-react';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { useCursorList, type CursorPage } from '../api/cursor-list';
import { ArticleCard, type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';
import { ErrorState } from '../components/ErrorState';

export function HomePage() {
  const pickup = useQuery({
    queryKey: keys.pickup,
    queryFn: async () => {
      const res = await api.api.articles.pickup.$get();
      if (!res.ok) throw new Error('failed');
      return (await res.json()) as ArticleItem[];
    },
  });
  const feed = useCursorList<ArticleItem>(keys.feed, async (cursor) => {
    const res = await api.api.articles.$get({ query: cursor ? { cursor } : {} });
    if (!res.ok) throw new Error('failed');
    return (await res.json()) as CursorPage<ArticleItem>;
  });
  const items = feed.items;

  if (feed.isError || pickup.isError) return <ErrorState />;

  return (
    <div className="space-y-10">
      {(pickup.data ?? []).length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold tracking-tight">
            <Pin className="size-5 text-accent-foreground" aria-hidden="true" />
            ピックアップ
          </h2>
          <div className="flex flex-col gap-3">
            {pickup.data!.map((it) => <ArticleCard key={it.id} item={it} variant="pickup" />)}
          </div>
        </section>
      )}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">新着</h2>
          <Link to="/articles/new" className="text-sm font-medium text-primary hover:underline">記事を書く</Link>
        </div>
        <ArticleList items={items} hasMore={feed.hasNextPage} onLoadMore={feed.fetchNextPage} />
      </section>
    </div>
  );
}
