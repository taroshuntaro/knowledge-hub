import { api } from '../api/client';
import { useCursorList, type CursorPage } from '../api/cursor-list';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';

export function BookmarksPage() {
  const q = useCursorList<ArticleItem>(['bookmarks'], async (cursor) => {
    const res = await api.api.me.bookmarks.$get({ query: cursor ? { cursor } : {} });
    if (!res.ok) throw new Error('failed');
    return (await res.json()) as CursorPage<ArticleItem>;
  });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState />;

  return (
    <section>
      <h1 className="mb-4 text-xl font-bold tracking-tight">ブックマーク</h1>
      <ArticleList
        items={q.items}
        hasMore={q.hasNextPage}
        onLoadMore={q.fetchNextPage}
        emptyText="ブックマークした記事はまだありません。"
      />
    </section>
  );
}
