import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../api/client';
import { keys } from '../api/keys';
import { useCursorList, type CursorPage } from '../api/cursor-list';
import { Avatar } from '../components/Avatar';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';

export function ProfilePage() {
  const { id = '' } = useParams();
  const profileQuery = useQuery({
    queryKey: keys.user(id),
    queryFn: async () => {
      const res = await api.api.users[':id'].$get({ param: { id } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });
  const articlesQuery = useCursorList<ArticleItem>(keys.userArticles(id), async (cursor) => {
    const res = await api.api.users[':id'].articles.$get({
      param: { id }, query: cursor ? { cursor } : {},
    });
    if (!res.ok) throw new Error('failed');
    return (await res.json()) as CursorPage<ArticleItem>;
  });

  if (profileQuery.isLoading) return <Loading />;
  if (profileQuery.isError) return <ErrorState />;
  if (!profileQuery.data) return <p className="text-muted-foreground">ユーザーが見つかりません。</p>;

  const profile = profileQuery.data;

  return (
    <section>
      <div className="flex items-center gap-4">
        <Avatar src={profile.avatarUrl} name={profile.displayName} className="size-16 text-xl font-semibold" />
        <div>
          <h2 className="text-xl font-bold tracking-tight">{profile.displayName}</h2>
          {(profile.department || profile.position || profile.hireYear !== null) && (
            <p className="text-sm text-muted-foreground">
              {[profile.department?.name, profile.position?.name].filter(Boolean).join(' / ')}
              {profile.hireYear !== null &&
                `${profile.department || profile.position ? ' ・ ' : ''}${profile.hireYear} 年入社`}
            </p>
          )}
          {profile.bio && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{profile.bio}</p>}
        </div>
      </div>
      <h3 className="mb-4 mt-8 text-lg font-semibold tracking-tight">執筆記事</h3>
      {articlesQuery.isLoading ? (
        <Loading />
      ) : (
        <ArticleList
          items={articlesQuery.items}
          hasMore={articlesQuery.hasNextPage}
          onLoadMore={articlesQuery.fetchNextPage}
          emptyText="公開記事はまだありません。"
        />
      )}
    </section>
  );
}
