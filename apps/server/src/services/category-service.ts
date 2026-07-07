import { and, asc, eq, isNull } from 'drizzle-orm';
import { articles, categories } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';

export type Category = typeof categories.$inferSelect;
export type CategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  children: CategoryNode[];
};

export async function listCategoryTree(db: Db): Promise<CategoryNode[]> {
  const rows = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
  const byId = new Map<string, CategoryNode>();
  for (const r of rows) {
    byId.set(r.id, { id: r.id, name: r.name, parentId: r.parentId, sortOrder: r.sortOrder, children: [] });
  }
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function createCategory(
  db: Db,
  input: { name: string; parentId?: string | null },
): Promise<Category> {
  if (input.parentId) {
    const parent = await db.query.categories.findFirst({ where: eq(categories.id, input.parentId) });
    if (!parent) throw new AppError('VALIDATION', '親カテゴリが存在しません', 400);
    if (parent.parentId) throw new AppError('VALIDATION', 'カテゴリは2階層までです', 400);
  }
  const [row] = await db
    .insert(categories)
    .values({ name: input.name, parentId: input.parentId ?? null })
    .returning();
  return row;
}

export async function updateCategory(
  db: Db,
  id: string,
  patch: { name?: string; sortOrder?: number },
): Promise<Category> {
  const [row] = await db.update(categories).set(patch).where(eq(categories.id, id)).returning();
  if (!row) throw new AppError('NOT_FOUND', 'カテゴリが見つかりません', 404);
  return row;
}

export async function deleteCategory(
  db: Db,
  id: string,
  reassignToId?: string | null,
): Promise<void> {
  const children = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id));
  if (children.length > 0) {
    throw new AppError('CATEGORY_NOT_EMPTY', '子カテゴリがあるため削除できません', 409);
  }
  const articleRows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.categoryId, id), isNull(articles.deletedAt)))
    .limit(1);
  const hasArticles = articleRows.length > 0;
  if (hasArticles && !reassignToId) {
    throw new AppError('CATEGORY_NOT_EMPTY', '記事があるため移行先を指定してください', 409);
  }
  if (reassignToId) {
    if (reassignToId === id) {
      throw new AppError('VALIDATION', '移行先に削除対象のカテゴリは指定できません', 400);
    }
    const target = await db.query.categories.findFirst({
      where: eq(categories.id, reassignToId), columns: { id: true },
    });
    if (!target) throw new AppError('VALIDATION', '移行先のカテゴリが存在しません', 400);
  }
  await db.transaction(async (tx) => {
    await tx.update(articles).set({ categoryId: reassignToId ?? null }).where(eq(articles.categoryId, id));
    await tx.delete(categories).where(eq(categories.id, id));
  });
}
