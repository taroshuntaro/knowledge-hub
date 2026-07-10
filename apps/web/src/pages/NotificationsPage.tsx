import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { useCursorList, type CursorPage } from '../api/cursor-list';
import { useOpenNotification, useUnreadCount } from '../api/notifications';
import { NETWORK_ERROR_MESSAGE } from '../lib/api-error';
import { notificationMessage, type NotificationItem } from '../lib/notification-message';
import { formatDate } from '../lib/date';
import { Button } from '@/components/ui/button';
import { EmptyState } from '../components/EmptyState';
import { Loading } from '../components/Loading';

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useCursorList<NotificationItem>(keys.notifications.list, async (cursor) => {
    const res = await api.api.notifications.$get({ query: cursor ? { cursor } : {} });
    if (!res.ok) throw new Error('failed');
    return (await res.json()) as CursorPage<NotificationItem>;
  });

  const unreadCountQuery = useUnreadCount();
  const items = query.items;
  const hasUnread = (unreadCountQuery.data?.count ?? 0) > 0;

  const openNotification = useOpenNotification();

  async function readAll() {
    setActionError(null);
    try {
      const res = await api.api.notifications['read-all'].$post();
      // hono クライアントは非 2xx でも throw しないため、明示的に確認して catch に流す
      if (!res.ok) throw new Error('failed');
    } catch {
      setActionError(NETWORK_ERROR_MESSAGE);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: keys.notifications.all });
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
        <Button type="button" variant="outline" className="self-center" onClick={query.fetchNextPage}>
          もっと見る
        </Button>
      )}
    </div>
  );
}
