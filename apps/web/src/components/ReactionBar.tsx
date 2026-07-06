import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REACTION_EMOJIS, type ArticleEngagement, type ReactionEmoji } from '@knowledge-hub/shared';
import { api } from '../api/client';
import { cn } from '@/lib/utils';

type ReactionVars = { emoji: ReactionEmoji; adding: boolean };

export function ReactionBar({ articleId }: { articleId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['engagement', articleId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.api.articles[':id'].engagement.$get({ param: { id: articleId } });
      if (!res.ok) throw new Error('failed');
      return (await res.json()) as ArticleEngagement;
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ emoji, adding }: ReactionVars) => {
      if (adding) {
        const res = await api.api.articles[':id'].reactions.$post({
          param: { id: articleId },
          json: { emoji },
        });
        if (!res.ok) throw new Error('failed');
        return res.json();
      }
      const res = await api.api.articles[':id'].reactions[':emoji'].$delete({
        param: { id: articleId, emoji },
      });
      if (!res.ok) throw new Error('failed');
      return null;
    },
    onMutate: async ({ emoji, adding }: ReactionVars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ArticleEngagement>(queryKey);
      queryClient.setQueryData<ArticleEngagement>(queryKey, (old) => {
        if (!old) return old;
        const nextCount = Math.max(0, (old.reactions[emoji] ?? 0) + (adding ? 1 : -1));
        const myReactions = adding
          ? [...old.myReactions, emoji]
          : old.myReactions.filter((e) => e !== emoji);
        return {
          ...old,
          reactions: { ...old.reactions, [emoji]: nextCount },
          myReactions,
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (query.isLoading || !query.data) return null;
  if (query.isError) return null;

  const { reactions, myReactions } = query.data;

  function toggle(emoji: ReactionEmoji) {
    const adding = !myReactions.includes(emoji);
    mutation.mutate({ emoji, adding });
  }

  return (
    <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="リアクション">
      {REACTION_EMOJIS.map((emoji) => {
        const reacted = myReactions.includes(emoji);
        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={reacted}
            onClick={() => toggle(emoji)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
              reacted
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-input bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <span>{emoji}</span>
            <span>{reactions[emoji] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
