import {
  and, desc, eq, exists, inArray, lt, or, sql,
} from 'drizzle-orm';
import {
  articles, articleTags, categories, tags, users,
} from '../db/schema';
import type { Db } from '../types';
import { fetchListMetadata } from './article-service';
import { publishedArticleWhere } from './article-visibility';
import { decodeCursor, encodeCursor } from './cursor';

export type SearchResultItem = {
  id: string;
  title: string;
  snippet: string;
  authorId: string;
  authorName: string;
  categoryId: string | null;
  publishedAt: string | null;
  updatedAt: string;
  heroImage: string | null;
  categoryName: string | null;
  authorAvatarUrl: string | null;
  tags: string[];
  reactionCount: number;
  commentCount: number;
};

export type SearchQuery = {
  q: string;
  categoryId?: string;
  tag?: string;
  authorId?: string;
  cursor?: string;
  limit: number;
};

export type SearchPage = { items: SearchResultItem[]; nextCursor: string | null };

/** 将来の RAG 実装の差し込み点（設計 §9）。route はこのインターフェースのみに依存する */
export interface SearchService {
  search(db: Db, query: SearchQuery): Promise<SearchPage>;
}

/** LIKE メタ文字をエスケープする（% _ \ をリテラル扱いにする） */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function createBigmSearchService(): SearchService {
  return {
    async search(db, query) {
      const pattern = `%${escapeLike(query.q)}%`;
      const qLower = query.q.toLowerCase();
      // lower() 式で比較する（GIN 式インデックス lower(search_text) gin_bigm_ops に一致する形）
      const conds = [
        publishedArticleWhere(),
        sql`lower(${articles.searchText}) like lower(${pattern})`,
      ];
      if (query.authorId) conds.push(eq(articles.authorId, query.authorId));
      if (query.categoryId) {
        // 親カテゴリ指定時は子カテゴリの記事も含める（カテゴリページと同じ意味論）
        const children = await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.parentId, query.categoryId));
        const ids = [query.categoryId, ...children.map((c) => c.id)];
        conds.push(inArray(articles.categoryId, ids));
      }
      if (query.tag) {
        conds.push(
          exists(
            db
              .select({ one: sql`1` })
              .from(articleTags)
              .innerJoin(tags, eq(articleTags.tagId, tags.id))
              .where(and(eq(articleTags.articleId, articles.id), eq(tags.name, query.tag))),
          ),
        );
      }

      // カーソル: pagePublished と同じ publishedAt desc, id desc の複合（既存 idiom を踏襲）
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conds.push(
          or(
            lt(articles.publishedAt, new Date(c.sortKey)),
            and(eq(articles.publishedAt, new Date(c.sortKey)), lt(articles.id, c.id)),
          )!,
        );
      }

      // スニペット: 最初のヒット位置の前後を切り出す。ヒットが先頭 40 文字以内なら先頭から
      const snippet = sql<string>`
        case
          when strpos(lower(${articles.searchText}), ${qLower}) > 40
          then '…' || substring(${articles.searchText} from strpos(lower(${articles.searchText}), ${qLower}) - 40 for 160)
          else left(${articles.searchText}, 160)
        end`;

      const rows = await db
        .select({
          id: articles.id,
          title: articles.title,
          snippet,
          authorId: articles.authorId,
          authorName: users.displayName,
          categoryId: articles.categoryId,
          publishedAt: articles.publishedAt,
          updatedAt: articles.updatedAt,
          heroImageUploadId: articles.heroImageUploadId,
          categoryName: categories.name,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(articles)
        .innerJoin(users, eq(articles.authorId, users.id))
        .leftJoin(categories, eq(articles.categoryId, categories.id))
        .where(and(...conds))
        .orderBy(desc(articles.publishedAt), desc(articles.id))
        .limit(query.limit + 1);

      const items = rows.slice(0, query.limit);
      const last = items[items.length - 1];
      const nextCursor = rows.length > query.limit ? encodeCursor(last.publishedAt, last.id) : null;

      const meta = await fetchListMetadata(db, items.map((r) => r.id));

      return {
        items: items.map((r) => {
          const m = meta.get(r.id);
          return {
            id: r.id,
            title: r.title,
            snippet: r.snippet,
            authorId: r.authorId,
            authorName: r.authorName,
            categoryId: r.categoryId,
            publishedAt: r.publishedAt?.toISOString() ?? null,
            updatedAt: r.updatedAt.toISOString(),
            heroImage: r.heroImageUploadId ? `/api/uploads/${r.heroImageUploadId}` : null,
            categoryName: r.categoryName,
            authorAvatarUrl: r.authorAvatarUrl,
            tags: m?.tags ?? [],
            reactionCount: m?.reactionCount ?? 0,
            commentCount: m?.commentCount ?? 0,
          };
        }),
        nextCursor,
      };
    },
  };
}
