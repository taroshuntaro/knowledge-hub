import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { NotificationItem } from '../lib/notification-message';
import { api } from './client';

export function useUnreadCount(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const res = await api.api.notifications['unread-count'].$get();
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    refetchInterval: options?.refetchInterval,
  });
}

/**
 * 通知を開く共通ハンドラ（ベルとページで同一の挙動）。
 * 未読なら既読化を試み、失敗しても記事遷移は必ず行う。既読化成功時のみ再取得する。
 * `beforeNavigate` はベルのポップオーバーを閉じる等の副作用に使う。
 */
export function useOpenNotification(beforeNavigate?: () => void) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (n: NotificationItem) => {
    beforeNavigate?.();
    if (!n.readAt) {
      try {
        const res = await api.api.notifications[':notificationId'].read.$post({
          param: { notificationId: n.id },
        });
        if (res.ok) await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      } catch {
        // ignore: navigation must still happen even if marking as read fails
      }
    }
    navigate(`/articles/${n.articleId}`);
  };
}
