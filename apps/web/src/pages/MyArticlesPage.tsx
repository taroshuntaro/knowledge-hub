import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';

const TABS = [
  { key: 'draft', label: '下書き' },
  { key: 'published', label: '公開済み' },
  { key: 'trash', label: 'ゴミ箱' },
] as const;

export function MyArticlesPage() {
  const [tab, setTab] = useState<'draft' | 'published' | 'trash'>('draft');
  const q = useInfiniteQuery({
    queryKey: ['mine', tab],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.articles.mine.$get({
        query: { tab, ...(pageParam ? { cursor: pageParam } : {}) },
      });
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items) as ArticleItem[];
  return (
    <section>
      <h2>マイ記事</h2>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <ArticleList items={items} hasMore={!!q.hasNextPage} onLoadMore={() => q.fetchNextPage()} emptyText="記事がありません。" />
    </section>
  );
}
