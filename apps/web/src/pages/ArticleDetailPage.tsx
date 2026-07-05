import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useArticle } from '../api/articles';
import { useMe } from '../auth/useMe';
import { Markdown } from '../lib/markdown';

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

  if (isLoading) return <p>読み込み中…</p>;
  if (isError) return <p>読み込みに失敗しました。</p>;
  if (!article) return <p>記事が見つかりません。</p>;

  const canEdit = me && (me.role === 'admin' || me.id === article.authorId);
  const canPin = me?.role === 'admin' && article.status === 'published';

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
    <article>
      {article.status === 'draft' && <p className="badge">下書き</p>}
      {article.deletedAt && <p className="badge">削除済み</p>}
      <h1>{article.title}</h1>
      <p className="meta">
        {article.authorName}
        {article.tags.length > 0 && (
          <span> ・ {article.tags.map((t) => <Link key={t} to={`/tags/${encodeURIComponent(t)}`}>#{t}</Link>)}</span>
        )}
      </p>
      {canEdit && <Link to={`/articles/${id}/edit`}>編集</Link>}
      {canPin && <button type="button" onClick={togglePin}>{article.pinnedAt ? 'ピン解除' : 'ピン留め'}</button>}
      {canEdit && (
        <button type="button" onClick={moveToTrash}>
          ゴミ箱へ
        </button>
      )}
      {actionError && <p role="status">{actionError}</p>}
      <Markdown source={article.bodyMd} />
    </article>
  );
}
