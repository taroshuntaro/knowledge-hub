import { useState } from 'react';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { useCursorList, type CursorPage } from '../api/cursor-list';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';
import { ErrorState } from '../components/ErrorState';

const TABS = [
  { key: 'draft', label: '下書き' },
  { key: 'published', label: '公開済み' },
  { key: 'trash', label: 'ゴミ箱' },
] as const;

export function MyArticlesPage() {
  const [tab, setTab] = useState<'draft' | 'published' | 'trash'>('draft');
  const q = useCursorList<ArticleItem>(keys.mine(tab), async (cursor) => {
    const res = await api.api.articles.mine.$get({
      query: { tab, ...(cursor ? { cursor } : {}) },
    });
    if (!res.ok) throw new Error('failed');
    return (await res.json()) as CursorPage<ArticleItem>;
  });
  if (q.isError) return <ErrorState />;
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">マイ記事</h2>
      <nav className="mb-4 inline-flex rounded-lg bg-muted p-1" aria-label="記事の絞り込み">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
          >
            {t.label}
          </button>
        ))}
      </nav>
      <ArticleList items={q.items} hasMore={q.hasNextPage} onLoadMore={q.fetchNextPage} emptyText="記事がありません。" />
    </section>
  );
}
