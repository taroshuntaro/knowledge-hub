import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { useArticle } from '../api/articles';
import { useMe } from '../auth/useMe';
import { useCanManage } from '../auth/useCanManage';
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
import { ErrorState } from '../components/ErrorState';
import { errorMessage, NETWORK_ERROR_MESSAGE } from '../lib/api-error';

export function ArticleDetailPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const { data: article, isLoading, isError } = useArticle(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);
  // 記事の管理権限（著者本人か admin）。編集/ゴミ箱操作/復元・完全削除に共通。
  const canManage = useCanManage(article?.authorId);

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState />;
  if (!article) return <p className="text-muted-foreground">記事が見つかりません。</p>;

  const isTrashed = Boolean(article.deletedAt);
  const canPin = me?.role === 'admin' && article.status === 'published' && !isTrashed;
  const canEngage = article.status === 'published' && !isTrashed;

  // 記事管理アクション共通処理: エラー初期化 → 実行 → 失敗表示 → 成功時の後処理。
  // call はレスポンスを返す API 呼び出し、fallback は !ok 時の既定文言、onOk は成功後の副作用。
  async function runAction(
    call: () => Promise<Response>,
    fallback: string,
    onOk: () => void | Promise<void>,
  ) {
    setActionError(null);
    try {
      const res = await call();
      if (!res.ok) {
        setActionError(await errorMessage(res, fallback));
        return;
      }
    } catch {
      setActionError(NETWORK_ERROR_MESSAGE);
      return;
    }
    await onOk();
  }

  const invalidateArticle = () => queryClient.invalidateQueries({ queryKey: keys.article(id) });

  const togglePin = () =>
    runAction(
      () => api.api.articles[':id'][article!.pinnedAt ? 'unpin' : 'pin'].$post({ param: { id } }),
      '操作に失敗しました',
      invalidateArticle,
    );

  const moveToTrash = () =>
    runAction(() => api.api.articles[':id'].$delete({ param: { id } }), '削除に失敗しました', () =>
      navigate('/me/articles'),
    );

  const restore = () =>
    runAction(
      () => api.api.articles[':id'].restore.$post({ param: { id } }),
      '復元に失敗しました',
      invalidateArticle,
    );

  const purge = () => {
    if (!window.confirm('この記事を完全に削除しますか？この操作は取り消せません。')) return;
    return runAction(
      () => api.api.articles[':id'].purge.$delete({ param: { id } }),
      '完全削除に失敗しました',
      () => navigate('/me/articles'),
    );
  };

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
        {canManage && !isTrashed && (
          <Button asChild size="sm">
            <Link to={`/articles/${id}/edit`}>編集</Link>
          </Button>
        )}
        {canEngage && <BookmarkButton articleId={article.id} />}
        {canPin && <Button type="button" variant="outline" size="sm" onClick={togglePin}>{article.pinnedAt ? 'ピン解除' : 'ピン留め'}</Button>}
        {canManage && !isTrashed && (
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
        {canManage && isTrashed && (
          <>
            <Button type="button" size="sm" onClick={restore}>復元</Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto border-destructive text-destructive hover:text-destructive"
              onClick={purge}
            >
              完全に削除
            </Button>
          </>
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
