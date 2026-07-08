import { useParams } from 'react-router';
import { api } from '../api/client';
import { useCursorList, type CursorPage } from '../api/cursor-list';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';
import { ErrorState } from '../components/ErrorState';

export function CategoryPage() {
  const { id = '' } = useParams();
  const q = useCursorList<ArticleItem>(['category', id], async (cursor) => {
    const res = await api.api.categories[':id'].articles.$get({
      param: { id }, query: cursor ? { cursor } : {},
    });
    if (!res.ok) throw new Error('failed');
    return (await res.json()) as CursorPage<ArticleItem>;
  });
  if (q.isError) return <ErrorState />;
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">カテゴリ</h2>
      <ArticleList items={q.items} hasMore={q.hasNextPage} onLoadMore={q.fetchNextPage} />
    </section>
  );
}
