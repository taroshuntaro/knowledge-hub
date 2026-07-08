import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { notificationMessage, type NotificationItem } from '../lib/notification-message';
import { formatDate } from '../lib/date';
import { Button } from '@/components/ui/button';
import { EmptyState } from '../components/EmptyState';
import { Loading } from '../components/Loading';

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.notifications.$get({
        query: { ...(pageParam ? { cursor: pageParam } : {}) },
      });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const unreadCountQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const res = await api.api.notifications['unread-count'].$get();
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });

  const items = (query.data?.pages ?? []).flatMap((p) => p.items) as NotificationItem[];
  const hasUnread = (unreadCountQuery.data?.count ?? 0) > 0;

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function openNotification(n: NotificationItem) {
    if (!n.readAt) {
      try {
        const res = await api.api.notifications[':notificationId'].read.$post({ param: { notificationId: n.id } });
        // 既読化に失敗しても記事遷移は行う。成功時のみ再取得して未読表示を更新する。
        if (res.ok) await invalidate();
      } catch {
        // ignore: navigation must still happen even if marking as read fails
      }
    }
    navigate(`/articles/${n.articleId}`);
  }

  async function readAll() {
    setActionError(null);
    let res: Awaited<ReturnType<typeof api.api.notifications['read-all']['$post']>>;
    try {
      res = await api.api.notifications['read-all'].$post();
    } catch {
      setActionError('通信に失敗しました。時間をおいて再試行してください');
      return;
    }
    // hono クライアントは非 2xx でも throw しないため、res.ok を明示的に確認する
    if (!res.ok) {
      setActionError('通信に失敗しました。時間をおいて再試行してください');
      return;
    }
    await invalidate();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">通知</h1>
        {hasUnread && (
          <Button type="button" variant="outline" size="sm" onClick={readAll}>
            すべて既読にする
          </Button>
        )}
      </div>

      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
      {query.isLoading && <Loading />}
      {query.isError && <p className="text-destructive">通知の読み込みに失敗しました。</p>}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState message="通知はまだありません" />
      )}
      {items.length > 0 && (
        <ul className="flex flex-col divide-y">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => openNotification(n)}
                className={`flex w-full items-baseline justify-between gap-4 px-2 py-3 text-left text-sm transition-colors hover:bg-muted ${n.readAt ? 'text-muted-foreground' : 'font-medium'}`}
              >
                <span>{notificationMessage(n)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button type="button" variant="outline" className="self-center" onClick={() => query.fetchNextPage()}>
          もっと見る
        </Button>
      )}
    </div>
  );
}
