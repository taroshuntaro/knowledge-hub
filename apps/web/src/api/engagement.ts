import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { keys } from './keys';

/** BookmarkButton / ReactionBar が同一記事のエンゲージメントを 1 キャッシュ・1 キーで共有する。 */
export function engagementKey(articleId: string) {
  return keys.engagement(articleId);
}

export function useEngagement(articleId: string) {
  return useQuery({
    queryKey: engagementKey(articleId),
    queryFn: async () => {
      const res = await api.api.articles[':id'].engagement.$get({ param: { id: articleId } });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });
}
