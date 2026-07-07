import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '../api/client';
import { ArticleCard, type ArticleItem } from '../components/ArticleCard';
import { CategorySelect } from '../components/CategorySelect';
import { EmptyState } from '../components/EmptyState';
import { Loading } from '../components/Loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SearchResultItem = {
  id: string;
  title: string;
  snippet: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  heroImage: string | null;
  tags: string[];
  reactionCount: number;
  commentCount: number;
  publishedAt: string | null;
  updatedAt: string;
};

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

  const query = useInfiniteQuery({
    queryKey: ['search', q, categoryId, tag, authorId],
    initialPageParam: undefined as string | undefined,
    enabled: q.length > 0,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.search.$get({
        query: {
          q,
          ...(categoryId ? { categoryId } : {}),
          ...(tag ? { tag } : {}),
          ...(authorId ? { authorId } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = (query.data?.pages ?? []).flatMap((p) => p.items) as SearchResultItem[];

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

      {q.length > 0 && query.isError && (
        <p className="text-destructive">読み込みに失敗しました。</p>
      )}

      {q.length > 0 && !query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState message={`『${q}』に一致する記事はありません`} />
      )}

      {q.length > 0 && !query.isLoading && !query.isError && items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map((item) => <ArticleCard key={item.id} item={toArticleItem(item)} />)}
          {query.hasNextPage && (
            <Button type="button" variant="outline" className="self-center" onClick={() => query.fetchNextPage()}>もっと見る</Button>
          )}
        </div>
      )}
    </section>
  );
}
