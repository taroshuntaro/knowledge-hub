import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api/client';
import { useMe } from '../auth/useMe';
import { Markdown } from '../lib/markdown';
import { formatDate } from '../lib/date';
import { errorMessage } from '../lib/api-error';
import { Button } from '@/components/ui/button';
import { Loading } from './Loading';
import { EmptyState } from './EmptyState';
import { MentionTextarea } from './MentionTextarea';

type CommentNode = {
  id: string;
  articleId: string;
  authorId: string;
  authorName: string;
  parentId: string | null;
  bodyMd: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  replies: CommentNode[];
};

function CommentForm({
  onSubmit,
  onCancel,
  submitLabel,
  autoFocus,
  initialValue,
}: {
  onSubmit: (bodyMd: string) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
  autoFocus?: boolean;
  initialValue?: string;
}) {
  const [value, setValue] = useState(initialValue ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!value.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(value);
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '投稿に失敗しました');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <MentionTextarea
        aria-label="コメント"
        value={value}
        onChange={setValue}
        rows={3}
        maxLength={5000}
        autoFocus={autoFocus}
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending || !value.trim()} onClick={handleSubmit}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
            キャンセル
          </Button>
        )}
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  articleId,
  isReply,
}: {
  comment: CommentNode;
  articleId: string;
  isReply: boolean;
}) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const canEdit = me?.id === comment.authorId;
  const canDelete = me?.id === comment.authorId || me?.role === 'admin';

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['comments', articleId] }),
      queryClient.invalidateQueries({ queryKey: ['engagement', articleId] }),
    ]);
  }

  async function postReply(bodyMd: string) {
    const res = await api.api.articles[':id'].comments.$post({
      param: { id: articleId },
      json: { bodyMd, parentId: comment.id },
    });
    if (!res.ok) throw new Error(await errorMessage(res, '返信に失敗しました'));
    await invalidate();
    setReplying(false);
  }

  async function saveEdit(bodyMd: string) {
    const res = await api.api.comments[':commentId'].$patch({
      param: { commentId: comment.id },
      json: { bodyMd },
    });
    if (!res.ok) throw new Error(await errorMessage(res, '更新に失敗しました'));
    await invalidate();
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm('このコメントを削除しますか？')) return;
    setDeletePending(true);
    setActionError(null);
    try {
      const res = await api.api.comments[':commentId'].$delete({ param: { commentId: comment.id } });
      if (!res.ok) {
        setActionError(await errorMessage(res, '削除に失敗しました'));
        return;
      }
      await invalidate();
    } catch {
      // ネットワーク断などの例外も握りつぶさずユーザーに提示する
      setActionError('通信に失敗しました。時間をおいて再試行してください');
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-muted-foreground">
        <Link to={`/users/${comment.authorId}`} className="font-medium hover:underline">{comment.authorName}</Link>
        <span className="ml-2">{formatDate(comment.createdAt)}</span>
      </p>
      {comment.isDeleted ? (
        <p className="text-muted-foreground italic">削除されました</p>
      ) : editing ? (
        <CommentForm
          submitLabel="保存"
          onSubmit={saveEdit}
          onCancel={() => setEditing(false)}
          autoFocus
          initialValue={comment.bodyMd ?? ''}
        />
      ) : (
        <Markdown source={comment.bodyMd ?? ''} />
      )}
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      {!comment.isDeleted && !editing && (
        <div className="flex gap-3">
          {!isReply && (
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setReplying((v) => !v)}>
              返信
            </button>
          )}
          {canEdit && (
            <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setEditing(true)}>
              編集
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="text-xs text-destructive hover:text-destructive hover:underline"
              onClick={handleDelete}
              disabled={deletePending}
            >
              削除
            </button>
          )}
        </div>
      )}
      {replying && (
        <div className="mt-1 pl-4">
          <CommentForm submitLabel="返信する" onSubmit={postReply} onCancel={() => setReplying(false)} autoFocus />
        </div>
      )}
      {!isReply && comment.replies.length > 0 && (
        <div className="mt-2 flex flex-col gap-4 border-l pl-4">
          {comment.replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} articleId={articleId} isReply />
          ))}
        </div>
      )}
    </div>
  );
}

export function CommentSection({ articleId }: { articleId: string }) {
  const queryClient = useQueryClient();
  const [postError, setPostError] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['comments', articleId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.articles[':id'].comments.$get({
        param: { id: articleId },
        query: { ...(pageParam ? { cursor: pageParam } : {}) },
      });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = (query.data?.pages ?? []).flatMap((p) => p.items) as CommentNode[];

  async function postComment(bodyMd: string) {
    setPostError(null);
    const res = await api.api.articles[':id'].comments.$post({
      param: { id: articleId },
      json: { bodyMd },
    });
    if (!res.ok) {
      const message = await errorMessage(res, '投稿に失敗しました');
      setPostError(message);
      throw new Error(message);
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['comments', articleId] }),
      queryClient.invalidateQueries({ queryKey: ['engagement', articleId] }),
    ]);
  }

  return (
    <section className="mt-8 flex flex-col gap-6">
      <h2 className="text-lg font-bold tracking-tight">コメント</h2>

      <CommentForm submitLabel="コメントする" onSubmit={postComment} />
      {postError && <p role="alert" className="text-sm text-destructive">{postError}</p>}

      {query.isLoading && <Loading />}
      {query.isError && <p className="text-destructive">コメントの読み込みに失敗しました。</p>}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState message="まだコメントはありません" />
      )}
      {!query.isLoading && !query.isError && items.length > 0 && (
        <div className="flex flex-col gap-6">
          {items.map((comment) => (
            <CommentItem key={comment.id} comment={comment} articleId={articleId} isReply={false} />
          ))}
        </div>
      )}
      {query.hasNextPage && (
        <Button type="button" variant="outline" className="self-center" onClick={() => query.fetchNextPage()}>
          もっと見る
        </Button>
      )}
    </section>
  );
}
