import { Link } from 'react-router';
import { Heart, MessageCircle } from 'lucide-react';
import { categoryColorClass } from '../lib/category-color';
import { formatDate } from '../lib/date';
import { Avatar } from './Avatar';

import type { ArticleCardData } from '@knowledge-hub/shared';

// 一覧カードのワイヤー形状は shared の ArticleCardData を単一の情報源とする。
export type ArticleItem = ArticleCardData;

export function ArticleCard({ item, variant = 'default' }: { item: ArticleItem; variant?: 'default' | 'pickup' }) {
  const date = formatDate(item.publishedAt ?? item.updatedAt);
  return (
    <article className={`flex items-stretch overflow-hidden rounded-xl border bg-card text-card-foreground transition-colors hover:border-ring/40 ${variant === 'pickup' ? 'border-ring/60' : ''}`}>
      <Link to={`/articles/${item.id}`} className="w-28 shrink-0 self-stretch sm:w-40" aria-hidden tabIndex={-1}>
        {item.heroImage ? (
          <img src={item.heroImage} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className={`flex aspect-[16/9] h-full w-full items-center justify-center text-2xl font-bold ${item.categoryId ? `${categoryColorClass(item.categoryId)} text-white` : 'bg-muted text-muted-foreground'}`}>
            {(item.categoryName ?? item.title).slice(0, 1)}
          </div>
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
        <div className="flex items-center gap-2">
          {variant === 'pickup' && <span className="text-xs font-bold text-accent-foreground">📌 ピックアップ</span>}
          {item.categoryName && item.categoryId && (
            <Link to={`/categories/${item.categoryId}`} className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-accent-foreground hover:underline">{item.categoryName}</Link>
          )}
        </div>
        <h3 className="line-clamp-2 font-semibold leading-snug">
          <Link to={`/articles/${item.id}`} className="hover:underline">{item.title}</Link>
        </h3>
        {item.excerpt && <p className="line-clamp-1 text-xs leading-relaxed text-muted-foreground">{item.excerpt}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <Link to={`/users/${item.authorId}`} className="flex items-center gap-1.5 hover:underline">
            <Avatar name={item.authorName} src={item.authorAvatarUrl} alt="" className="size-4" />
            {item.authorName}
          </Link>
          {date && <span>· {date}</span>}
          {item.tags.slice(0, 3).map((t) => (
            <Link key={t} to={`/tags/${encodeURIComponent(t)}`} className="rounded-full border px-2 py-0.5 hover:bg-muted">{t}</Link>
          ))}
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1" aria-label={`リアクション ${item.reactionCount}件`}><Heart className="size-3" aria-hidden />{item.reactionCount}</span>
            <span className="flex items-center gap-1" aria-label={`コメント ${item.commentCount}件`}><MessageCircle className="size-3" aria-hidden />{item.commentCount}</span>
          </span>
        </div>
      </div>
    </article>
  );
}
