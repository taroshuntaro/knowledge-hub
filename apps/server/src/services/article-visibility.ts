import { and, eq, isNull } from 'drizzle-orm';
import { articles } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';

// 「公開かつ未削除」= 一般ユーザーに見えてよい、という記事の唯一の可視性不変条件を
// 1 箇所に定義する。記事本体だけでなく、そこから派生するもの（コメント/リアクション/
// ブックマーク/通知/埋め込み画像/検索）の可視判定がすべてこの定義を共有するため、
// ルールを変える（例: scheduled publish や unlisted 列の追加）ときにここだけ直せばよい。

// WHERE 用の SQL フラグメント。`and(publishedArticleWhere(), extraWhere)` のように合成する。
export function publishedArticleWhere() {
  return and(eq(articles.status, 'published'), isNull(articles.deletedAt));
}

// 読み込み済みの行に対する述語版（SQL を発行せずに判定したい経路用）。
export function isArticleVisible(row: { status: 'draft' | 'published'; deletedAt: Date | null }): boolean {
  return row.status === 'published' && row.deletedAt === null;
}

// 対象記事が公開・未削除であることを確認する。draft / 削除済み / 不在は NOT_FOUND。
// コメント・エンゲージメント（リアクション/ブックマーク）双方の入口で使う。
export async function assertPublishedArticle(db: Db, articleId: string) {
  const row = await db.query.articles.findFirst({ where: eq(articles.id, articleId) });
  if (!row || !isArticleVisible(row)) {
    throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  }
  return row;
}
