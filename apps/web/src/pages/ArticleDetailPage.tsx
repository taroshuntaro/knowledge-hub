import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useArticle } from '../api/articles';
import { useMe } from '../auth/useMe';
import { Markdown } from '../lib/markdown';

export function ArticleDetailPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const { data: article, isLoading } = useArticle(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  if (isLoading) return <p>読み込み中…</p>;
  if (!article) return <p>記事が見つかりません。</p>;

  const canEdit = me && (me.role === 'admin' || me.id === article.authorId);
  const canPin = me?.role === 'admin' && article.status === 'published';

  async function togglePin() {
    await api.api.articles[':id'][article!.pinnedAt ? 'unpin' : 'pin'].$post({ param: { id } });
    await queryClient.invalidateQueries({ queryKey: ['article', id] });
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
        <button
          type="button"
          onClick={async () => {
            await api.api.articles[':id'].$delete({ param: { id } });
            navigate('/me/articles');
          }}
        >
          ゴミ箱へ
        </button>
      )}
      <Markdown source={article.bodyMd} />
    </article>
  );
}
