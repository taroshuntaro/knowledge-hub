import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useArticle } from '../api/articles';
import { useMe } from '../auth/useMe';
import { Markdown } from '../lib/markdown';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Loading } from '../components/Loading';
import { CommentSection } from '../components/CommentSection';
import { ReactionBar } from '../components/ReactionBar';
import { BookmarkButton } from '../components/BookmarkButton';

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

  return (
    <article className="mx-auto max-w-[42rem]">
      <div className="flex gap-2">
        {article.status === 'draft' && <Badge variant="secondary">下書き</Badge>}
        {article.deletedAt && <Badge variant="outline">削除済み</Badge>}
      </div>
      <h1 className="mt-3 text-3xl font-bold leading-snug tracking-tight">{article.title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        <Link to={`/users/${article.authorId}`} className="hover:underline">{article.authorName}</Link>
        {article.tags.length > 0 && (
          <span className="ml-2 inline-flex flex-wrap gap-1.5">
            {article.tags.map((t) => (
              <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                #{t}
              </Link>
            ))}
          </span>
        )}
      </p>
      <div className="mt-4 flex items-center gap-2">
        {canEngage && <BookmarkButton articleId={article.id} />}
        {canEdit && (
          <Button asChild variant="outline" size="sm">
            <Link to={`/articles/${id}/edit`}>編集</Link>
          </Button>
        )}
        {canPin && <Button type="button" variant="outline" size="sm" onClick={togglePin}>{article.pinnedAt ? 'ピン解除' : 'ピン留め'}</Button>}
        {canEdit && <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={moveToTrash}>ゴミ箱へ</Button>}
      </div>
      {actionError && <p role="status" className="mt-2 text-sm text-destructive">{actionError}</p>}
      <Separator className="my-6" />
      <Markdown source={article.bodyMd} />
      {canEngage && <ReactionBar articleId={article.id} />}
      {canEngage && <CommentSection articleId={article.id} />}
    </article>
  );
}
