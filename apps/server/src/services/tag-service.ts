import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { articles, articleTags, tags } from '../db/schema';
import type { Db } from '../types';

function normalize(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim();
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export async function upsertTags(db: Db, names: string[]): Promise<{ id: string; name: string }[]> {
  const norm = normalize(names);
  if (norm.length === 0) return [];
  await db
    .insert(tags)
    .values(norm.map((name) => ({ name })))
    .onConflictDoNothing({ target: tags.name });
  return db.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.name, norm));
}

export async function setArticleTags(db: Db, articleId: string, names: string[]): Promise<void> {
  const rows = await upsertTags(db, names);
  await db.transaction(async (tx) => {
    await tx.delete(articleTags).where(eq(articleTags.articleId, articleId));
    if (rows.length > 0) {
      await tx.insert(articleTags).values(rows.map((t) => ({ articleId, tagId: t.id })));
    }
  });
}

export async function getArticleTagNames(db: Db, articleId: string): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(articleTags)
    .innerJoin(tags, eq(articleTags.tagId, tags.id))
    .where(eq(articleTags.articleId, articleId));
  return rows.map((r) => r.name);
}

export async function listPopularTags(
  db: Db,
  limit = 20,
): Promise<{ name: string; count: number }[]> {
  const rows = await db
    .select({ name: tags.name, count: sql<number>`count(*)::int` })
    .from(articleTags)
    .innerJoin(tags, eq(articleTags.tagId, tags.id))
    .innerJoin(articles, eq(articleTags.articleId, articles.id))
    .where(and(eq(articles.status, 'published'), isNull(articles.deletedAt)))
    .groupBy(tags.name)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows;
}
