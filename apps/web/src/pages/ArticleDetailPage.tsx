import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useArticle } from '../api/articles';
import { useMe } from '../auth/useMe';
import { Markdown } from '../lib/markdown';
import { formatDate } from '../lib/date';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Loading } from '../components/Loading';
import { Avatar } from '../components/Avatar';
import { CommentSection } from '../components/CommentSection';
import { ReactionBar } from '../components/ReactionBar';
import { BookmarkButton } from '../components/BookmarkButton';
import { HeroImage } from '../components/HeroImage';

async function errorMessage(res: { json(): Promise<unknown> }, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
}

export function ArticleDetailPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const { data: article, isLoading, isError } = useArticle(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  if (isError) return <p className="text-destructive">読み込みに失敗しました。</p>;
  if (!article) return <p className="text-muted-foreground">記事が見つかりません。</p>;

  const canEdit = me && (me.role === 'admin' || me.id === article.authorId);
  const canPin = me?.role === 'admin' && article.status === 'published';
  const canEngage = article.status === 'published' && !article.deletedAt;

  async function togglePin() {
    setActionError(null);
    const res = await api.api.articles[':id'][article!.pinnedAt ? 'unpin' : 'pin'].$post({ param: { id } });
    if (!res.ok) {
      setActionError(await errorMessage(res, '操作に失敗しました'));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['article', id] });
  }

  async function moveToTrash() {
    setActionError(null);
    const res = await api.api.articles[':id'].$delete({ param: { id } });
    if (!res.ok) {
      setActionError(await errorMessage(res, '削除に失敗しました'));
      return;
    }
    navigate('/me/articles');
  }

  const authorName = article.authorName;
  const date = formatDate(article.publishedAt ?? article.updatedAt);

  return (
    <article className="mx-auto max-w-[42rem]">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">← フィードに戻る</Link>
      <div className="mt-3 flex gap-2">
        {article.status === 'draft' && <Badge variant="secondary">下書き</Badge>}
        {article.deletedAt && <Badge variant="outline">削除済み</Badge>}
      </div>
      {article.heroImage && (
        <HeroImage src={article.heroImage} alt={article.title} className="mt-3" />
      )}
      <h1 className="mt-4 text-3xl font-bold leading-snug tracking-tight">{article.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
        {article.categoryName && article.categoryId && (
          <Link to={`/categories/${article.categoryId}`} className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-foreground hover:underline">
            {article.categoryName}
          </Link>
        )}
        <Link to={`/users/${article.authorId}`} className="flex items-center gap-1.5 hover:underline">
          <Avatar name={authorName} src={article.authorAvatarUrl} alt="" className="size-5" />
          {authorName}
        </Link>
        <span aria-hidden="true">·</span>
        <span>{date}</span>
        {article.tags.map((t) => (
          <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted">
            {t}
          </Link>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-b pb-4">
        {canEdit && (
          <Button asChild size="sm">
            <Link to={`/articles/${id}/edit`}>編集</Link>
          </Button>
        )}
        {canEngage && <BookmarkButton articleId={article.id} />}
        {canPin && <Button type="button" variant="outline" size="sm" onClick={togglePin}>{article.pinnedAt ? 'ピン解除' : 'ピン留め'}</Button>}
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto border-destructive text-destructive hover:text-destructive"
            onClick={moveToTrash}
          >
            ゴミ箱へ
          </Button>
        )}
      </div>
      {actionError && <p role="status" className="mt-2 text-sm text-destructive">{actionError}</p>}
      <div className="mt-6">
        <Markdown source={article.bodyMd} />
      </div>
      {canEngage && (
        <div className="mt-6 space-y-6">
          <ReactionBar articleId={article.id} />
          <CommentSection articleId={article.id} />
        </div>
      )}
    </article>
  );
}
