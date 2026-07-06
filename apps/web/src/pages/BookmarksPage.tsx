import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';
import { Loading } from '../components/Loading';

export function BookmarksPage() {
  const q = useInfiniteQuery({
    queryKey: ['bookmarks'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.me.bookmarks.$get({
        query: pageParam ? { cursor: pageParam } : {},
      });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <p className="text-destructive">読み込みに失敗しました。</p>;

  const items = (q.data?.pages ?? []).flatMap((p) => p.items) as ArticleItem[];

  return (
    <section>
      <h1 className="mb-4 text-xl font-bold tracking-tight">ブックマーク</h1>
      <ArticleList
        items={items}
        hasMore={!!q.hasNextPage}
        onLoadMore={() => q.fetchNextPage()}
        emptyText="ブックマークした記事はまだありません。"
      />
    </section>
  );
}
