import { Link } from 'react-router';

export type ArticleItem = {
  id: string; title: string; excerpt: string; authorId: string; authorName: string;
  categoryId: string | null; pinnedAt: string | null; publishedAt: string | null; updatedAt: string;
};

export function ArticleCard({ item }: { item: ArticleItem }) {
  return (
    <article className="group rounded-xl border bg-card p-5 text-card-foreground transition-colors hover:border-ring/40">
      <h3 className="text-lg font-semibold leading-snug">
        <Link to={`/articles/${item.id}`} className="hover:underline">{item.title}</Link>
      </h3>
      {item.excerpt && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{item.excerpt}</p>}
      <p className="mt-3 text-xs text-muted-foreground">
        <Link to={`/users/${item.authorId}`} className="hover:underline">{item.authorName}</Link>
      </p>
    </article>
  );
}
