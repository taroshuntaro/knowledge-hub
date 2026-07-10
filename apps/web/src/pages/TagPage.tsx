import { useParams } from 'react-router';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { useCursorList, type CursorPage } from '../api/cursor-list';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';
import { ErrorState } from '../components/ErrorState';

export function TagPage() {
  const { name = '' } = useParams();
  const q = useCursorList<ArticleItem>(keys.tag(name), async (cursor) => {
    const res = await api.api.tags[':name'].articles.$get({
      param: { name }, query: cursor ? { cursor } : {},
    });
    if (!res.ok) throw new Error('failed');
    return (await res.json()) as CursorPage<ArticleItem>;
  });
  if (q.isError) return <ErrorState />;
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">#{name}</h2>
      <ArticleList items={q.items} hasMore={q.hasNextPage} onLoadMore={q.fetchNextPage} />
    </section>
  );
}
