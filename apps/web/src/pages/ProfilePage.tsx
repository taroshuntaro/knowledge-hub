import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../api/client';
import { Avatar } from '../components/Avatar';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';
import { Loading } from '../components/Loading';

export function ProfilePage() {
  const { id = '' } = useParams();
  const profileQuery = useQuery({
    queryKey: ['user', id],
    queryFn: async () => {
      const res = await api.api.users[':id'].$get({ param: { id } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });
  const articlesQuery = useInfiniteQuery({
    queryKey: ['user-articles', id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.users[':id'].articles.$get({
        param: { id }, query: pageParam ? { cursor: pageParam } : {},
      });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (profileQuery.isLoading) return <Loading />;
  if (profileQuery.isError) return <p className="text-destructive">読み込みに失敗しました。</p>;
  if (!profileQuery.data) return <p className="text-muted-foreground">ユーザーが見つかりません。</p>;

  const profile = profileQuery.data;
  const items = (articlesQuery.data?.pages ?? []).flatMap((p) => p.items) as ArticleItem[];

  return (
    <section>
      <div className="flex items-center gap-4">
        <Avatar src={profile.avatarUrl} name={profile.displayName} className="size-16 text-xl font-semibold" />
        <div>
          <h2 className="text-xl font-bold tracking-tight">{profile.displayName}</h2>
          {profile.bio && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{profile.bio}</p>}
        </div>
      </div>
      <h3 className="mb-4 mt-8 text-lg font-semibold tracking-tight">執筆記事</h3>
      {articlesQuery.isLoading ? (
        <Loading />
      ) : (
        <ArticleList
          items={items}
          hasMore={!!articlesQuery.hasNextPage}
          onLoadMore={() => articlesQuery.fetchNextPage()}
          emptyText="公開記事はまだありません。"
        />
      )}
    </section>
  );
}
