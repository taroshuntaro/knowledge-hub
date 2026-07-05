import { Link } from 'react-router';

export type ArticleItem = {
  id: string; title: string; excerpt: string; authorId: string; authorName: string;
  categoryId: string | null; pinnedAt: string | null; publishedAt: string | null; updatedAt: string;
};

export function ArticleCard({ item }: { item: ArticleItem }) {
  return (
    <article className="article-card">
      <h3><Link to={`/articles/${item.id}`}>{item.title}</Link></h3>
      <p className="excerpt">{item.excerpt}</p>
      <p className="meta">{item.authorName}</p>
    </article>
  );
}
