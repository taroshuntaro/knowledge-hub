import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '../api/client';
import { useOpenNotification, useUnreadCount } from '../api/notifications';
import { notificationMessage, type NotificationItem } from '../lib/notification-message';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function NotificationBell() {
  const [open, setOpen] = useState(false);

  const { data: unread } = useUnreadCount({ refetchInterval: 30_000 });

  const { data: recent } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: async () => {
      const res = await api.api.notifications.$get({ query: { limit: '5' } });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    enabled: open,
  });

  const openNotification = useOpenNotification(() => setOpen(false));

  const count = unread?.count ?? 0;
  const items = (recent?.items ?? []) as NotificationItem[];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="通知" className="relative">
          <Bell className="size-4" />
          {count > 0 && (
            <span
              aria-label={`未読 ${count} 件`}
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
            >
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        {items.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">通知はありません</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  className={`w-full rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted ${n.readAt ? 'text-muted-foreground' : 'font-medium'}`}
                >
                  {notificationMessage(n)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 border-t pt-1">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-md px-2 py-1.5 text-center text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            すべて見る
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
