import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark } from 'lucide-react';
import { api } from '../api/client';
import { cn } from '@/lib/utils';

export function BookmarkButton({ articleId }: { articleId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['engagement', articleId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.api.articles[':id'].engagement.$get({ param: { id: articleId } });
      if (!res.ok) throw new Error('failed');
      return await res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (bookmarked: boolean) => {
      if (bookmarked) {
        const res = await api.api.articles[':id'].bookmark.$delete({ param: { id: articleId } });
        if (!res.ok) throw new Error('failed');
        return null;
      }
      const res = await api.api.articles[':id'].bookmark.$post({ param: { id: articleId } });
      if (!res.ok) throw new Error('failed');
      return null;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (query.isLoading || !query.data || query.isError) return null;

  const { bookmarked } = query.data;

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        aria-pressed={bookmarked}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(bookmarked)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
          bookmarked
            ? 'border-accent bg-accent text-accent-foreground'
            : 'border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Bookmark className="size-4" fill={bookmarked ? 'currentColor' : 'none'} />
        {bookmarked ? 'ブックマーク済み' : 'ブックマーク'}
      </button>
      {mutation.isError && <span role="status" className="text-xs text-destructive">操作に失敗しました</span>}
    </span>
  );
}
