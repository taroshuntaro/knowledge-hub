import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { notificationMessage, type NotificationItem } from '../lib/notification-message';
import { Button } from '@/components/ui/button';
import { EmptyState } from '../components/EmptyState';
import { Loading } from '../components/Loading';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
        await api.api.notifications[':notificationId'].read.$post({ param: { notificationId: n.id } });
        await invalidate();
      } catch {
        // ignore: navigation must still happen even if marking as read fails
      }
    }
    navigate(`/articles/${n.articleId}`);
  }

  async function readAll() {
    await api.api.notifications['read-all'].$post();
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
