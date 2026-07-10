import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ArticleCardData } from '@knowledge-hub/shared';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { useCursorList, type CursorPage } from '../api/cursor-list';
import { ArticleCard, type ArticleItem } from '../components/ArticleCard';
import { CategorySelect } from '../components/CategorySelect';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// 検索結果は共有カード型（pinnedAt なし）＋ スニペットのワイヤー形状。
type SearchResultItem = Omit<ArticleCardData, 'pinnedAt'> & { snippet: string };

function toArticleItem(item: SearchResultItem): ArticleItem {
  return {
    id: item.id,
    title: item.title,
    excerpt: item.snippet,
    authorId: item.authorId,
    authorName: item.authorName,
    authorAvatarUrl: item.authorAvatarUrl,
    categoryId: item.categoryId,
    categoryName: item.categoryName,
    heroImage: item.heroImage,
    tags: item.tags,
    reactionCount: item.reactionCount,
    commentCount: item.commentCount,
    pinnedAt: null,
    publishedAt: item.publishedAt,
    updatedAt: item.updatedAt,
  };
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const categoryId = searchParams.get('categoryId');
  const tag = searchParams.get('tag') ?? '';
  const authorId = searchParams.get('authorId');
  const [tagInput, setTagInput] = useState(tag);
  const [qInput, setQInput] = useState(q);

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  function reflectTag() {
    const t = tagInput.trim();
    if (t !== tag) updateParam('tag', t || null);
  }

  const query = useCursorList<SearchResultItem>(
    keys.search(q, categoryId, tag, authorId),
    async (cursor) => {
      const res = await api.api.search.$get({
        query: {
          q,
          ...(categoryId ? { categoryId } : {}),
          ...(tag ? { tag } : {}),
          ...(authorId ? { authorId } : {}),
          ...(cursor ? { cursor } : {}),
        },
      });
      if (!res.ok) throw new Error('failed');
      return (await res.json()) as CursorPage<SearchResultItem>;
    },
    { enabled: q.length > 0 },
  );

  const items = query.items;

  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">検索</h2>
      <form
        role="search"
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          updateParam('q', qInput.trim() || null);
        }}
      >
        <Input
          type="search"
          aria-label="キーワード"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="flex-1"
        />
        <Button type="submit">検索</Button>
      </form>
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="search-category">カテゴリ</Label>
          <CategorySelect id="search-category" value={categoryId} onChange={(v) => updateParam('categoryId', v)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="search-tag">タグ</Label>
          <Input
            id="search-tag"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onBlur={reflectTag}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                reflectTag();
              }
            }}
          />
        </div>
      </div>

      {q.length === 0 && <p className="text-muted-foreground">キーワードを入力してください</p>}

      {q.length > 0 && query.isLoading && <Loading />}

      {q.length > 0 && query.isError && <ErrorState />}

      {q.length > 0 && !query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState message={`『${q}』に一致する記事はありません`} />
      )}

      {q.length > 0 && !query.isLoading && !query.isError && items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map((item) => <ArticleCard key={item.id} item={toArticleItem(item)} />)}
          {query.hasNextPage && (
            <Button type="button" variant="outline" className="self-center" onClick={query.fetchNextPage}>もっと見る</Button>
          )}
        </div>
      )}
    </section>
  );
}
