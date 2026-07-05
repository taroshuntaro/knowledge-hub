import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { ArticleCard, type ArticleItem } from './ArticleCard';

export function ArticleList({
  items, hasMore, onLoadMore, emptyText = '記事がありません。',
}: {
  items: ArticleItem[];
  hasMore: boolean;
  onLoadMore: () => void;
  emptyText?: string;
}) {
  if (items.length === 0) return <EmptyState message={emptyText} />;
  return (
    <div className="flex flex-col gap-3">
      {items.map((it) => <ArticleCard key={it.id} item={it} />)}
      {hasMore && (
        <Button type="button" variant="outline" className="self-center" onClick={onLoadMore}>もっと見る</Button>
      )}
    </div>
  );
}
