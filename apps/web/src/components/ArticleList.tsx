import { ArticleCard, type ArticleItem } from './ArticleCard';

export function ArticleList({
  items, hasMore, onLoadMore, emptyText = '記事がありません。',
}: {
  items: ArticleItem[];
  hasMore: boolean;
  onLoadMore: () => void;
  emptyText?: string;
}) {
  if (items.length === 0) return <p>{emptyText}</p>;
  return (
    <div className="article-list">
      {items.map((it) => <ArticleCard key={it.id} item={it} />)}
      {hasMore && <button type="button" onClick={onLoadMore}>もっと見る</button>}
    </div>
  );
}
