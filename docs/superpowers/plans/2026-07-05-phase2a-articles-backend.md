# Phase 2a: 記事バックエンド + 読む/書く(Markdownソース) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事の作成・下書き/公開・論理削除/復元・リビジョン・ピックアップ・カテゴリ/タグ・画像アップロードのバックエンドと、閲覧画面 + Markdown ソースエディタ（CodeMirror）までを実装し、「書ける・公開できる・読める」状態にする。リッチ Tiptap エディタと往復変換は Phase 2b。

**Architecture:** Phase 1 の `buildApp(deps)` DI・`AppEnv`・統一エラー・Drizzle・Testcontainers パターンをそのまま踏襲。記事の書き込みは必ず `ArticleService` を単一経路で通す（将来の RAG フック点）。画像は S3 互換ストレージ（オンプレ=MinIO / AWS=S3、差分は環境変数のみ）を `Storage` 抽象越しに扱い、`Mailer` と同じく本番実装 + テスト用 Fake を用意する。Markdown はビュー側で `react-markdown` + `remark-gfm` + `rehype-sanitize` によりサニタイズしてレンダリングする。

**Tech Stack:** Hono (Node.js, ESM) / Drizzle ORM + PostgreSQL / Zod (shared) / @aws-sdk/client-s3 / React SPA + TanStack Query + React Router / CodeMirror 6 / react-markdown。Vitest + Testcontainers。

## Global Constraints

- Node.js 24 系 / ESM（`"type": "module"`）/ TypeScript strict。
- API エラーは統一形式 `{ code, message, details? }`。`code` は shared の `ErrorCode` に限定。HTTP は VALIDATION=400 / UNAUTHORIZED=401 / FORBIDDEN=403 / NOT_FOUND=404 / CONFLICT=409 / 500。
- バリデーションの正は shared の Zod スキーマ。サーバー・Web 双方がこれを参照する。
- 記事本文は **Markdown 文字列 `body_md` を正**とする。エディタ・検索・将来 RAG すべての源泉。
- 記事 URL は ID ベース（`/articles/:id`）。スラッグ化しない。
- 主キーは UUID、タイムスタンプは `timestamptz`。論理削除は `deleted_at`。
- 記事は**カテゴリ 1 つ必須。ただし必須チェックは公開時のみ**（下書きは未設定可、自動保存を妨げない）。
- カテゴリは深さ最大 2。作成・改名・並び替え・削除は admin のみ。配下（子カテゴリ・記事）が空でなければ削除不可（記事は移行先指定で付け替え）。
- 権限: `member` は記事の作成・公開・自分の記事編集/削除。`admin` は任意記事の削除・カテゴリ管理・ピックアップ管理。下書き/削除済みは本人 + admin のみ閲覧可。
- 記事編集は `updated_at` 比較の楽観ロック（他タブ対策）。不一致は CONFLICT 409。
- ピックアップは admin が公開記事のみ対象。非公開化・削除でピンは自動解除（自動復活なし）。
- 画像は画像 MIME のみ・サイズ上限あり。Markdown にはアプリ経由の安定 URL `/api/uploads/:id` を埋め込み、配信は認証必須。
- Markdown レンダリングはサニタイズ必須（`rehype-sanitize`）。生 HTML 不許可。
- UI 日本語 / コミットは英語 Conventional Commits / 1 コミット 1 論理変更 / TDD（RED→GREEN）。
- コミット前に対象パッケージの `test` と `typecheck` を通す。テスト実行前に `docker compose up -d`（server 統合テストは Testcontainers で実 PostgreSQL 起動）。

---

## File Structure

**shared (`packages/shared/src/`)**
- `errors.ts`（変更: `CONFLICT` / `CATEGORY_NOT_EMPTY` 追加）
- `schemas/article.ts`（新規: 記事 create/update/publish/list クエリ、カテゴリ、タグの Zod）
- `types.ts`（変更: `ArticleStatus` 等の共有型）
- `index.ts`（変更: 追加 export）

**server (`apps/server/src/`)**
- `db/schema.ts`（変更: `categories` / `tags` / `articleTags` / `articles` / `articleRevisions` / `uploads` 追加）
- `services/markdown.ts`（新規: `buildSearchText`）
- `services/category-service.ts` / `tag-service.ts` / `article-service.ts` / `storage.ts` / `upload-service.ts`（新規）
- `services/permissions.ts`（変更: resource 対応 `can()`）
- `routes/categories.ts` / `tags.ts` / `articles.ts` / `uploads.ts`（新規）
- `app.ts`（変更: 新ルート登録 + `storage` を DI に追加）
- `config.ts`（変更: S3 設定追加）
- `types.ts`（変更: `AppEnv` に `storage` 追加、`Storage` re-export）
- `index.ts`（変更: `createS3Storage` を注入）
- `test/helpers.ts`（変更: `resetDb` に新テーブル追加、`createTestApp` に Fake storage）
- `test/factories.ts`（変更: `createTestCategory` / `createTestArticle`）

**web (`apps/web/src/`)**
- `lib/markdown.tsx`（新規: サニタイズ済み Markdown ビュー）
- `pages/`（新規: `ArticleDetailPage` / `EditorPage` / `CategoryPage` / `TagPage` / `MyArticlesPage` / `AdminCategoriesPage`、`HomePage` 差し替え）
- `components/`（新規: `CategorySelect` / `TagInput` / `ArticleCard` / `Pagination`）
- `App.tsx`（変更: ルート追加）

---

### Task 1: shared スキーマ・型・エラーコード（記事/カテゴリ/タグ）

**Files:**
- Modify: `packages/shared/src/errors.ts`, `packages/shared/src/types.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/schemas/article.ts`
- Test: `packages/shared/src/schemas/article.test.ts`

**Interfaces:**
- Produces:
  - `ErrorCode` に `'CONFLICT' | 'CATEGORY_NOT_EMPTY'` を追加
  - 型: `ArticleStatus = 'draft' | 'published'`
  - Zod: `createArticleSchema`（title/bodyMd/categoryId?/tags）, `updateArticleSchema`（+ `expectedUpdatedAt`）, `listQuerySchema`（cursor?/limit）, `categoryCreateSchema` / `categoryUpdateSchema` / `categoryDeleteSchema`（reassignToId?）
- Consumes: なし

- [ ] **Step 1: 失敗するテストを書く**

`packages/shared/src/schemas/article.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  createArticleSchema,
  updateArticleSchema,
  listQuerySchema,
  categoryCreateSchema,
} from './article';

describe('article schemas', () => {
  it('createArticleSchema: 最小の下書き入力を通す（categoryId 省略可）', () => {
    const r = createArticleSchema.safeParse({ title: 'メモ', bodyMd: '', tags: [] });
    expect(r.success).toBe(true);
  });

  it('createArticleSchema: title 空は不可', () => {
    const r = createArticleSchema.safeParse({ title: '', bodyMd: 'x', tags: [] });
    expect(r.success).toBe(false);
  });

  it('createArticleSchema: tags は最大 10 個・各 30 文字', () => {
    const r = createArticleSchema.safeParse({
      title: 't',
      bodyMd: '',
      tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
    });
    expect(r.success).toBe(false);
  });

  it('updateArticleSchema: expectedUpdatedAt が必須', () => {
    const r = updateArticleSchema.safeParse({ title: 't', bodyMd: '', tags: [] });
    expect(r.success).toBe(false);
  });

  it('listQuerySchema: limit を coerce しデフォルト 20', () => {
    const r = listQuerySchema.parse({});
    expect(r.limit).toBe(20);
  });

  it('categoryCreateSchema: name 必須', () => {
    expect(categoryCreateSchema.safeParse({ name: '' }).success).toBe(false);
    expect(categoryCreateSchema.safeParse({ name: 'テック' }).success).toBe(true);
  });
});
```

Run: `pnpm --filter @knowledge-hub/shared test src/schemas/article.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 2: エラーコードと型を追加**

`packages/shared/src/errors.ts` の `ERROR_CODES` 配列に追記（既存要素は保持し、末尾付近に追加）:
```ts
export const ERROR_CODES = [
  'VALIDATION', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
  'INVALID_CREDENTIALS', 'RATE_LIMITED', 'EMAIL_TAKEN', 'INVALID_TOKEN',
  'LAST_ADMIN', 'PASSWORD_AUTH_DISABLED', 'INTERNAL',
  'CONFLICT', 'CATEGORY_NOT_EMPTY',
] as const;
```

`packages/shared/src/types.ts` に追記:
```ts
export type ArticleStatus = 'draft' | 'published';
```

- [ ] **Step 3: article スキーマを実装**

`packages/shared/src/schemas/article.ts`:
```ts
import { z } from 'zod';

export const tagNameSchema = z.string().trim().min(1).max(30);

export const createArticleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().max(200_000),
  categoryId: z.string().uuid().nullable().optional(),
  tags: z.array(tagNameSchema).max(10),
});

export const updateArticleSchema = createArticleSchema.extend({
  expectedUpdatedAt: z.string().datetime(),
});

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(50),
  parentId: z.string().uuid().nullable().optional(),
});

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  sortOrder: z.number().int().optional(),
});

export const categoryDeleteSchema = z.object({
  reassignToId: z.string().uuid().nullable().optional(),
});
```

`packages/shared/src/index.ts` に追記:
```ts
export * from './schemas/article';
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/shared test src/schemas/article.test.ts`
Expected: PASS（6 件）

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add article/category zod schemas and error codes"
```

---

### Task 2: Drizzle スキーマ・マイグレーション（記事系テーブル）+ テスト基盤更新

**Files:**
- Modify: `apps/server/src/db/schema.ts`, `apps/server/src/test/helpers.ts`, `apps/server/src/test/factories.ts`
- Create: マイグレーション（`pnpm --filter @knowledge-hub/server db:generate` で生成）
- Test: `apps/server/src/db/schema-articles.test.ts`

**Interfaces:**
- Produces: Drizzle テーブル `categories` / `tags` / `articleTags` / `articles` / `articleRevisions` / `uploads`（`$inferSelect` / `$inferInsert` を後続タスクが利用）。`resetDb` が新テーブルも truncate。ファクトリ `createTestCategory(db, overrides?)` / `createTestArticle(db, overrides?)`
- Consumes: Task 1 の型は不要（DB 層は独立）

- [ ] **Step 1: スキーマにテーブルを追加**

`apps/server/src/db/schema.ts` に追記（既存 import 行に `integer` を追加。既存テーブルは変更しない）:
```ts
import {
  boolean, integer, pgEnum, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';

export const articleStatusEnum = pgEnum('article_status', ['draft', 'published']);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});

export const articles = pgTable('articles', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  categoryId: uuid('category_id').references(() => categories.id),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull().default(''),
  searchText: text('search_text').notNull().default(''),
  status: articleStatusEnum('status').notNull().default('draft'),
  pinnedAt: timestamp('pinned_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const articleTags = pgTable(
  'article_tags',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => ({ uq: unique().on(t.articleId, t.tagId) }),
);

export const articleRevisions = pgTable('article_revisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  articleId: uuid('article_id')
    .notNull()
    .references(() => articles.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull(),
  savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
});

export const uploads = pgTable('uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  uploaderId: uuid('uploader_id')
    .notNull()
    .references(() => users.id),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: マイグレーションを生成**

Run: `pnpm --filter @knowledge-hub/server db:generate`
Expected: `apps/server/drizzle/` に新しい SQL マイグレーションが 1 つ生成される。生成後、内容に上記 6 テーブルの `CREATE TABLE` が含まれることを目視確認。

- [ ] **Step 3: テストヘルパを更新**

`apps/server/src/test/helpers.ts` の `resetDb` を差し替え（truncate 対象に新テーブルを追加。順序は cascade があるため users を含め一括で可）:
```ts
export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate table article_tags, article_revisions, articles, tags, categories, uploads, users, sessions, invitations, password_reset_tokens cascade`,
  );
}
```

- [ ] **Step 4: ファクトリを追加**

`apps/server/src/test/factories.ts` に追記（既存 import に `categories, articles` を追加）:
```ts
import { articles, categories, users } from '../db/schema';

export async function createTestCategory(
  db: Db,
  overrides: Partial<typeof categories.$inferInsert> = {},
) {
  const [row] = await db
    .insert(categories)
    .values({ name: 'テック', ...overrides })
    .returning();
  return row;
}

export async function createTestArticle(
  db: Db,
  overrides: Partial<typeof articles.$inferInsert> = {},
) {
  const authorId = overrides.authorId ?? (await createTestUser(db)).id;
  const [row] = await db
    .insert(articles)
    .values({ authorId, title: 'テスト記事', bodyMd: '本文', ...overrides })
    .returning();
  return row;
}
```

- [ ] **Step 5: スキーマの疎通テストを書く**

`apps/server/src/db/schema-articles.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { articles } from './schema';
import { createTestArticle, createTestCategory } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('article schema', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('記事を挿入でき、既定は draft・deletedAt は null', async () => {
    const cat = await createTestCategory(ctx.db);
    const a = await createTestArticle(ctx.db, { categoryId: cat.id });
    expect(a.status).toBe('draft');
    expect(a.deletedAt).toBeNull();
    const rows = await ctx.db.select().from(articles);
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 6: マイグレーション適用 + テスト**

Run: `pnpm --filter @knowledge-hub/server test src/db/schema-articles.test.ts`
Expected: PASS（Testcontainers の global-setup が新マイグレーションを適用する）

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add articles, categories, tags and uploads schema"
```

---

### Task 3: 権限チェック can() の resource 対応拡張

**Files:**
- Modify: `apps/server/src/services/permissions.ts`
- Test: `apps/server/src/services/permissions.test.ts`（ケース追記）

**Interfaces:**
- Produces: `Action` に記事/カテゴリ系を追加。`can(user: SessionUser, action: Action, resource?: { authorId?: string }): boolean`。既存の `requireAdmin`（`can(user, 'user:manage')`）は非互換変更なし
- Consumes: shared `SessionUser`

- [ ] **Step 1: テストを追記**

`apps/server/src/services/permissions.test.ts` の `describe('can', ...)` 内に追加:
```ts
  it('member は記事を作成できる', () => {
    expect(can(user('member'), 'article:create')).toBe(true);
  });
  it('member は自分の記事のみ編集できる', () => {
    expect(can(user('member'), 'article:edit', { authorId: '1' })).toBe(true);
    expect(can(user('member'), 'article:edit', { authorId: '2' })).toBe(false);
  });
  it('admin は他人の記事も削除できる', () => {
    expect(can(user('admin'), 'article:delete', { authorId: '2' })).toBe(true);
  });
  it('member はピン留め・カテゴリ管理できない', () => {
    expect(can(user('member'), 'article:pin')).toBe(false);
    expect(can(user('member'), 'category:manage')).toBe(false);
  });
```
（既存の `user()` ヘルパの `id` は `'1'` を返す点に依存）

Run: `pnpm --filter @knowledge-hub/server test src/services/permissions.test.ts`
Expected: FAIL

- [ ] **Step 2: 実装**

`apps/server/src/services/permissions.ts` を差し替え:
```ts
import type { SessionUser } from '@knowledge-hub/shared';

export type Action =
  | 'user:manage'
  | 'article:create'
  | 'article:edit'
  | 'article:delete'
  | 'article:pin'
  | 'category:manage';

export function can(
  user: SessionUser,
  action: Action,
  resource?: { authorId?: string },
): boolean {
  switch (action) {
    case 'user:manage':
    case 'article:pin':
    case 'category:manage':
      return user.role === 'admin';
    case 'article:create':
      return true;
    case 'article:edit':
    case 'article:delete':
      return user.role === 'admin' || resource?.authorId === user.id;
  }
}
```

- [ ] **Step 3: テスト**

Run: `pnpm --filter @knowledge-hub/server test src/services/permissions.test.ts`
Expected: PASS（既存 2 + 追加 4）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: extend can() with resource-aware article permissions"
```

---

### Task 4: search_text 生成ヘルパ

**Files:**
- Create: `apps/server/src/services/markdown.ts`
- Test: `apps/server/src/services/markdown.test.ts`

**Interfaces:**
- Produces: `buildSearchText(input: { title: string; bodyMd: string; tags: string[] }): string` — タイトル + 本文の Markdown 記法を除去した平文 + タグを空白連結。pg_bigm 全文検索の対象列を生成する（検索クエリ自体は Phase 3）
- Consumes: なし

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/markdown.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildSearchText } from './markdown';

describe('buildSearchText', () => {
  it('タイトル・本文平文・タグを連結する', () => {
    const s = buildSearchText({
      title: '入門ガイド',
      bodyMd: '# 見出し\n\n**太字** と [リンク](https://ex.com) と `code`。',
      tags: ['AWS', '新人向け'],
    });
    expect(s).toContain('入門ガイド');
    expect(s).toContain('見出し');
    expect(s).toContain('太字');
    expect(s).toContain('リンク');
    expect(s).toContain('AWS');
    expect(s).toContain('新人向け');
  });

  it('Markdown 記号（#, *, [], 記法）を落とす', () => {
    const s = buildSearchText({ title: 't', bodyMd: '## H\n- item\n> quote', tags: [] });
    expect(s).not.toContain('##');
    expect(s).not.toContain('- item'.slice(0, 2)); // 行頭のリストマーカー '- ' を除去
    expect(s).toContain('item');
    expect(s).toContain('quote');
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/markdown.test.ts`
Expected: FAIL

- [ ] **Step 2: 実装**

`apps/server/src/services/markdown.ts`（依存を増やさない軽量な平文化。往復精度は不要で、検索対象語を残せれば十分）:
```ts
export function buildSearchText(input: {
  title: string;
  bodyMd: string;
  tags: string[];
}): string {
  const plain = input.bodyMd
    .replace(/```[\s\S]*?```/g, ' ') // コードブロック
    .replace(/`([^`]*)`/g, '$1') // インラインコード
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // 画像/リンク → テキストのみ
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 見出しマーカー
    .replace(/^\s{0,3}>\s?/gm, '') // 引用マーカー
    .replace(/^\s*[-*+]\s+/gm, '') // 箇条書きマーカー
    .replace(/^\s*\d+\.\s+/gm, '') // 番号付きマーカー
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1') // 強調/打消し
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ') // 水平線
    .replace(/\|/g, ' ') // テーブル区切り
    .replace(/\s+/g, ' ')
    .trim();
  return [input.title, plain, ...input.tags].join(' ').trim();
}
```

- [ ] **Step 3: テスト**

Run: `pnpm --filter @knowledge-hub/server test src/services/markdown.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add search_text builder that strips markdown"
```

---

### Task 5: CategoryService（2 階層・削除ガード）

**Files:**
- Create: `apps/server/src/services/category-service.ts`
- Test: `apps/server/src/services/category-service.test.ts`

**Interfaces:**
- Produces:
  - `type CategoryNode = { id; name; parentId: string | null; sortOrder: number; children: CategoryNode[] }`
  - `listCategoryTree(db): Promise<CategoryNode[]>`（親→子の2階層ツリー、sortOrder 昇順）
  - `createCategory(db, { name, parentId? }): Promise<Category>`（parentId 指定時、親が存在し親自身が第1階層であること=深さ2超は VALIDATION 400）
  - `updateCategory(db, id, { name?, sortOrder? }): Promise<Category>`（不在は NOT_FOUND 404）
  - `deleteCategory(db, id, reassignToId?): Promise<void>`（子カテゴリありは CATEGORY_NOT_EMPTY 409。記事ありで reassignToId 未指定も CATEGORY_NOT_EMPTY。reassignToId 指定時は記事を付け替えてから削除）
  - `Category = typeof categories.$inferSelect`
- Consumes: Task 2 の `categories` / `articles`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/category-service.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { articles } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createTestArticle, createTestCategory } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createCategory,
  deleteCategory,
  listCategoryTree,
} from './category-service';

describe('category service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('親子を作成しツリーで返す', async () => {
    const parent = await createCategory(ctx.db, { name: 'テック' });
    await createCategory(ctx.db, { name: 'フロントエンド', parentId: parent.id });
    const tree = await listCategoryTree(ctx.db);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.name)).toEqual(['フロントエンド']);
  });

  it('深さ3（孫）は VALIDATION で拒否', async () => {
    const parent = await createCategory(ctx.db, { name: 'テック' });
    const child = await createCategory(ctx.db, { name: 'フロント', parentId: parent.id });
    await expect(
      createCategory(ctx.db, { name: 'React', parentId: child.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('子カテゴリがあると削除不可（CATEGORY_NOT_EMPTY）', async () => {
    const parent = await createCategory(ctx.db, { name: 'テック' });
    await createCategory(ctx.db, { name: '子', parentId: parent.id });
    await expect(deleteCategory(ctx.db, parent.id)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_EMPTY',
    });
  });

  it('記事があり reassignToId 未指定は CATEGORY_NOT_EMPTY', async () => {
    const cat = await createTestCategory(ctx.db, { name: 'A' });
    await createTestArticle(ctx.db, { categoryId: cat.id });
    await expect(deleteCategory(ctx.db, cat.id)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_EMPTY',
    });
  });

  it('reassignToId 指定で記事を付け替えて削除できる', async () => {
    const from = await createTestCategory(ctx.db, { name: 'From' });
    const to = await createTestCategory(ctx.db, { name: 'To' });
    const art = await createTestArticle(ctx.db, { categoryId: from.id });
    await deleteCategory(ctx.db, from.id, to.id);
    const [moved] = await ctx.db.select().from(articles).where(eq(articles.id, art.id));
    expect(moved.categoryId).toBe(to.id);
    expect(await listCategoryTree(ctx.db)).toHaveLength(1);
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/category-service.test.ts`
Expected: FAIL

- [ ] **Step 2: 実装**

`apps/server/src/services/category-service.ts`:
```ts
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
  const [{ count } = { count: 0 }] = await db
    .select({ count: articles.id })
    .from(articles)
    .where(and(eq(articles.categoryId, id), isNull(articles.deletedAt)))
    .limit(1);
  const hasArticles = count !== undefined && count !== null;
  if (hasArticles && !reassignToId) {
    throw new AppError('CATEGORY_NOT_EMPTY', '記事があるため移行先を指定してください', 409);
  }
  await db.transaction(async (tx) => {
    if (reassignToId) {
      await tx.update(articles).set({ categoryId: reassignToId }).where(eq(articles.categoryId, id));
    }
    await tx.delete(categories).where(eq(categories.id, id));
  });
}
```

- [ ] **Step 3: テスト**

Run: `pnpm --filter @knowledge-hub/server test src/services/category-service.test.ts`
Expected: PASS（5 件）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add category service with depth and delete guards"
```

---

### Task 6: TagService（find-or-create・人気タグ）

**Files:**
- Create: `apps/server/src/services/tag-service.ts`
- Test: `apps/server/src/services/tag-service.test.ts`

**Interfaces:**
- Produces:
  - `upsertTags(db, names: string[]): Promise<{ id: string; name: string }[]>` — 正規化（trim）した名前で find-or-create。重複・空は除去
  - `setArticleTags(db, articleId, names: string[]): Promise<void>` — article_tags を names に一致するよう置換（upsertTags 経由）
  - `getArticleTagNames(db, articleId): Promise<string[]>`
  - `listPopularTags(db, limit?): Promise<{ name: string; count: number }[]>` — 公開記事に付く数の降順
- Consumes: Task 2 の `tags` / `articleTags` / `articles`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/tag-service.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestArticle } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { getArticleTagNames, setArticleTags, upsertTags } from './tag-service';

describe('tag service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('upsertTags は既存タグを再利用し重複を作らない', async () => {
    const a = await upsertTags(ctx.db, ['AWS', 'AWS', ' AWS ']);
    expect(a).toHaveLength(1);
    const b = await upsertTags(ctx.db, ['AWS', 'React']);
    expect(b).toHaveLength(2);
    expect(a[0].id).toBe(b.find((t) => t.name === 'AWS')!.id);
  });

  it('setArticleTags は記事のタグ集合を置換する', async () => {
    const art = await createTestArticle(ctx.db);
    await setArticleTags(ctx.db, art.id, ['AWS', 'React']);
    expect((await getArticleTagNames(ctx.db, art.id)).sort()).toEqual(['AWS', 'React']);
    await setArticleTags(ctx.db, art.id, ['React', 'Vue']);
    expect((await getArticleTagNames(ctx.db, art.id)).sort()).toEqual(['React', 'Vue']);
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/tag-service.test.ts`
Expected: FAIL

- [ ] **Step 2: 実装**

`apps/server/src/services/tag-service.ts`:
```ts
import { desc, eq, inArray, sql } from 'drizzle-orm';
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
    .where(eq(articles.status, 'published'))
    .groupBy(tags.name)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows;
}
```

- [ ] **Step 3: テスト**

Run: `pnpm --filter @knowledge-hub/server test src/services/tag-service.test.ts`
Expected: PASS（2 件）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add tag service with upsert and popular tags"
```

---

### Task 7: ArticleService 書き込み（下書き作成・更新・リビジョン・楽観ロック）

**Files:**
- Create: `apps/server/src/services/article-service.ts`
- Test: `apps/server/src/services/article-service.write.test.ts`

**Interfaces:**
- Produces:
  - `type ArticleRecord = typeof articles.$inferSelect`
  - `type ArticleInput = { title: string; bodyMd: string; categoryId?: string | null; tags: string[] }`
  - `createArticle(db, authorId, input): Promise<ArticleRecord>` — status=draft で作成。search_text 生成、タグ設定、リビジョン記録
  - `updateArticle(db, id, editor: SessionUser, input & { expectedUpdatedAt: string }): Promise<ArticleRecord>` — 権限（author or admin）なしは FORBIDDEN 403、不在/削除済みは NOT_FOUND 404、`expectedUpdatedAt` 不一致は CONFLICT 409。search_text/タグ更新、リビジョン記録、updatedAt 更新
- Consumes: Task 3 `can()`, Task 4 `buildSearchText`, Task 6 `setArticleTags`, shared `SessionUser`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/article-service.write.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { articleRevisions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createArticle, updateArticle } from './article-service';
import { getArticleTagNames } from './tag-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '',
});

describe('article write', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('下書きを作成し search_text とタグとリビジョンが入る', async () => {
    const u = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, u.id, {
      title: 'AWS 入門', bodyMd: '# 見出し\n本文', tags: ['AWS'],
    });
    expect(a.status).toBe('draft');
    expect(a.searchText).toContain('見出し');
    expect(await getArticleTagNames(ctx.db, a.id)).toEqual(['AWS']);
    const revs = await ctx.db.select().from(articleRevisions).where(eq(articleRevisions.articleId, a.id));
    expect(revs).toHaveLength(1);
  });

  it('他人は更新できない（FORBIDDEN）', async () => {
    const author = await createTestUser(ctx.db);
    const other = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, author.id, { title: 't', bodyMd: '', tags: [] });
    await expect(
      updateArticle(ctx.db, a.id, asUser(other.id), {
        title: 'x', bodyMd: '', tags: [], expectedUpdatedAt: a.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('admin は他人の記事を更新できる', async () => {
    const author = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const a = await createArticle(ctx.db, author.id, { title: 't', bodyMd: '', tags: [] });
    const updated = await updateArticle(ctx.db, a.id, asUser(admin.id, 'admin'), {
      title: '改題', bodyMd: '', tags: [], expectedUpdatedAt: a.updatedAt.toISOString(),
    });
    expect(updated.title).toBe('改題');
  });

  it('expectedUpdatedAt 不一致は CONFLICT', async () => {
    const u = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', tags: [] });
    await expect(
      updateArticle(ctx.db, a.id, asUser(u.id), {
        title: 'x', bodyMd: '', tags: [],
        expectedUpdatedAt: new Date(a.updatedAt.getTime() - 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/article-service.write.test.ts`
Expected: FAIL

- [ ] **Step 2: 実装**

`apps/server/src/services/article-service.ts`:
```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { articleRevisions, articles } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { buildSearchText } from './markdown';
import { can } from './permissions';
import { getArticleTagNames, setArticleTags } from './tag-service';

export type ArticleRecord = typeof articles.$inferSelect;
export type ArticleInput = {
  title: string;
  bodyMd: string;
  categoryId?: string | null;
  tags: string[];
};

async function snapshot(db: Db, article: { id: string; title: string; bodyMd: string }) {
  await db.insert(articleRevisions).values({
    articleId: article.id,
    title: article.title,
    bodyMd: article.bodyMd,
  });
}

export async function createArticle(
  db: Db,
  authorId: string,
  input: ArticleInput,
): Promise<ArticleRecord> {
  const searchText = buildSearchText({ title: input.title, bodyMd: input.bodyMd, tags: input.tags });
  const [row] = await db
    .insert(articles)
    .values({
      authorId,
      categoryId: input.categoryId ?? null,
      title: input.title,
      bodyMd: input.bodyMd,
      searchText,
    })
    .returning();
  await setArticleTags(db, row.id, input.tags);
  await snapshot(db, row);
  return row;
}

async function loadEditable(db: Db, id: string): Promise<ArticleRecord> {
  const row = await db.query.articles.findFirst({
    where: and(eq(articles.id, id), isNull(articles.deletedAt)),
  });
  if (!row) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  return row;
}

export async function updateArticle(
  db: Db,
  id: string,
  editor: SessionUser,
  input: ArticleInput & { expectedUpdatedAt: string },
): Promise<ArticleRecord> {
  const current = await loadEditable(db, id);
  if (!can(editor, 'article:edit', { authorId: current.authorId })) {
    throw new AppError('FORBIDDEN', 'この記事を編集する権限がありません', 403);
  }
  if (current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
    throw new AppError('CONFLICT', '別の場所で更新されています。読み込み直してください', 409);
  }
  const searchText = buildSearchText({ title: input.title, bodyMd: input.bodyMd, tags: input.tags });
  const [row] = await db
    .update(articles)
    .set({
      title: input.title,
      bodyMd: input.bodyMd,
      categoryId: input.categoryId ?? null,
      searchText,
      updatedAt: new Date(),
    })
    .where(eq(articles.id, id))
    .returning();
  await setArticleTags(db, id, input.tags);
  await snapshot(db, row);
  return row;
}

// re-export（read/lifecycle タスクで同ファイルに追記される getArticleTagNames の橋渡し）
export { getArticleTagNames };
```

- [ ] **Step 3: テスト**

Run: `pnpm --filter @knowledge-hub/server test src/services/article-service.write.test.ts`
Expected: PASS（4 件）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add article create/update with revisions and optimistic lock"
```

---

### Task 8: ArticleService ライフサイクル（公開/非公開・削除/復元/物理削除・ピン）

**Files:**
- Modify: `apps/server/src/services/article-service.ts`
- Test: `apps/server/src/services/article-service.lifecycle.test.ts`

**Interfaces:**
- Produces（すべて `article-service.ts` に追記）:
  - `publishArticle(db, id, editor): Promise<ArticleRecord>` — 権限チェック。**categoryId 未設定は VALIDATION 400**。status=published, publishedAt を初回のみ設定
  - `unpublishArticle(db, id, editor): Promise<ArticleRecord>` — draft へ戻す。**pinnedAt を null に自動解除**
  - `softDeleteArticle(db, id, editor): Promise<void>` — deletedAt 設定、**pinnedAt を null に自動解除**
  - `restoreArticle(db, id, editor): Promise<void>` — deletedAt を null（ピンは自動復活しない）
  - `purgeArticle(db, id, admin): Promise<void>` — 物理削除。admin 限定（`can(user,'user:manage')` を流用せず role 判定）
  - `setPinned(db, id, admin, pinned: boolean): Promise<ArticleRecord>` — `article:pin` 権限。**公開記事のみピン可**（非公開はVALIDATION 400）
- Consumes: Task 7 の内部関数、Task 3 `can()`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/article-service.lifecycle.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createArticle, publishArticle, setPinned, softDeleteArticle, unpublishArticle,
} from './article-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '',
});

describe('article lifecycle', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('カテゴリ未設定の公開は VALIDATION', async () => {
    const u = await createTestUser(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', tags: [] });
    await expect(publishArticle(ctx.db, a.id, asUser(u.id))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('公開すると published_at が入り、ピンできる', async () => {
    const u = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const cat = (await import('../test/factories')).createTestCategory;
    const c = await cat(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', categoryId: c.id, tags: [] });
    const pub = await publishArticle(ctx.db, a.id, asUser(u.id));
    expect(pub.status).toBe('published');
    expect(pub.publishedAt).not.toBeNull();
    const pinned = await setPinned(ctx.db, a.id, asUser(admin.id, 'admin'), true);
    expect(pinned.pinnedAt).not.toBeNull();
  });

  it('非公開化でピンが自動解除される', async () => {
    const u = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const c = await (await import('../test/factories')).createTestCategory(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', categoryId: c.id, tags: [] });
    await publishArticle(ctx.db, a.id, asUser(u.id));
    await setPinned(ctx.db, a.id, asUser(admin.id, 'admin'), true);
    const back = await unpublishArticle(ctx.db, a.id, asUser(u.id));
    expect(back.status).toBe('draft');
    expect(back.pinnedAt).toBeNull();
  });

  it('未公開記事はピンできない（VALIDATION）', async () => {
    const u = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', tags: [] });
    await expect(setPinned(ctx.db, a.id, asUser(admin.id, 'admin'), true)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('削除でピン自動解除・deletedAt 設定', async () => {
    const u = await createTestUser(ctx.db);
    const admin = await createTestUser(ctx.db, { role: 'admin' });
    const c = await (await import('../test/factories')).createTestCategory(ctx.db);
    const a = await createArticle(ctx.db, u.id, { title: 't', bodyMd: '', categoryId: c.id, tags: [] });
    await publishArticle(ctx.db, a.id, asUser(u.id));
    await setPinned(ctx.db, a.id, asUser(admin.id, 'admin'), true);
    await softDeleteArticle(ctx.db, a.id, asUser(u.id));
    const row = await ctx.db.query.articles.findFirst({
      where: (t, { eq }) => eq(t.id, a.id),
    });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.pinnedAt).toBeNull();
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/article-service.lifecycle.test.ts`
Expected: FAIL

- [ ] **Step 2: 実装（`article-service.ts` の末尾 `export { getArticleTagNames };` の直前に追記）**

```ts
async function loadOwned(db: Db, id: string, editor: SessionUser): Promise<ArticleRecord> {
  const current = await loadEditable(db, id);
  if (!can(editor, 'article:edit', { authorId: current.authorId })) {
    throw new AppError('FORBIDDEN', 'この記事を操作する権限がありません', 403);
  }
  return current;
}

export async function publishArticle(db: Db, id: string, editor: SessionUser): Promise<ArticleRecord> {
  const current = await loadOwned(db, id, editor);
  if (!current.categoryId) {
    throw new AppError('VALIDATION', '公開にはカテゴリの指定が必要です', 400);
  }
  const [row] = await db
    .update(articles)
    .set({ status: 'published', publishedAt: current.publishedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(articles.id, id))
    .returning();
  return row;
}

export async function unpublishArticle(db: Db, id: string, editor: SessionUser): Promise<ArticleRecord> {
  await loadOwned(db, id, editor);
  const [row] = await db
    .update(articles)
    .set({ status: 'draft', pinnedAt: null, updatedAt: new Date() })
    .where(eq(articles.id, id))
    .returning();
  return row;
}

export async function softDeleteArticle(db: Db, id: string, editor: SessionUser): Promise<void> {
  await loadOwned(db, id, editor);
  await db.update(articles).set({ deletedAt: new Date(), pinnedAt: null }).where(eq(articles.id, id));
}

export async function restoreArticle(db: Db, id: string, editor: SessionUser): Promise<void> {
  const row = await db.query.articles.findFirst({ where: eq(articles.id, id) });
  if (!row) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  if (!can(editor, 'article:edit', { authorId: row.authorId })) {
    throw new AppError('FORBIDDEN', 'この記事を操作する権限がありません', 403);
  }
  await db.update(articles).set({ deletedAt: null }).where(eq(articles.id, id));
}

export async function purgeArticle(db: Db, id: string, admin: SessionUser): Promise<void> {
  if (admin.role !== 'admin') throw new AppError('FORBIDDEN', '管理者権限が必要です', 403);
  await db.delete(articles).where(eq(articles.id, id));
}

export async function setPinned(
  db: Db,
  id: string,
  admin: SessionUser,
  pinned: boolean,
): Promise<ArticleRecord> {
  if (!can(admin, 'article:pin')) throw new AppError('FORBIDDEN', 'ピン留めには管理者権限が必要です', 403);
  const current = await loadEditable(db, id);
  if (pinned && current.status !== 'published') {
    throw new AppError('VALIDATION', '公開記事のみピン留めできます', 400);
  }
  const [row] = await db
    .update(articles)
    .set({ pinnedAt: pinned ? new Date() : null })
    .where(eq(articles.id, id))
    .returning();
  return row;
}
```

- [ ] **Step 3: テスト**

Run: `pnpm --filter @knowledge-hub/server test src/services/article-service.lifecycle.test.ts`
Expected: PASS（5 件）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add article publish, delete, restore and pin lifecycle"
```

---

### Task 9: ArticleService 読み取り（フィード・ピックアップ・カテゴリ/タグ/著者別・詳細）

**Files:**
- Modify: `apps/server/src/services/article-service.ts`
- Test: `apps/server/src/services/article-service.read.test.ts`

**Interfaces:**
- Produces（`article-service.ts` に追記）:
  - `type ArticleListItem = { id; title; excerpt; authorId; authorName; categoryId: string|null; pinnedAt: Date|null; publishedAt: Date|null; updatedAt: Date }`
  - `type Page<T> = { items: T[]; nextCursor: string | null }`
  - `listFeed(db, { cursor?, limit }): Promise<Page<ArticleListItem>>` — published かつ未削除、`published_at` desc, id desc のカーソルページング
  - `listPickup(db): Promise<ArticleListItem[]>` — published 未削除 pinnedAt not null、pinnedAt desc
  - `listByCategory(db, categoryId, page): Promise<Page<ArticleListItem>>` — 指定カテゴリ **+ その子カテゴリ**の公開記事
  - `listByTag(db, tagName, page): Promise<Page<ArticleListItem>>`
  - `listByAuthor(db, authorId, page): Promise<Page<ArticleListItem>>` — 公開記事のみ
  - `listMine(db, authorId, tab: 'draft'|'published'|'trash', page): Promise<Page<ArticleListItem>>`
  - `getArticleForViewer(db, id, viewer): Promise<ArticleDetail>` — 公開は全員可。draft/削除済みは著者 + admin のみ、他は NOT_FOUND。`ArticleDetail = ArticleRecord & { authorName; tags: string[] }`
  - `listRevisions(db, id, editor): Promise<{ id; title; savedAt: Date }[]>`
- Consumes: Task 8 の内部関数、`categories`/`tags`/`articleTags`/`users`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/article-service.read.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { createTestCategory, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createArticle, getArticleForViewer, listByCategory, listFeed, publishArticle,
} from './article-service';

const asUser = (id: string, role: 'member' | 'admin' = 'member'): SessionUser => ({
  id, email: 'x@example.com', displayName: 'X', role, avatarUrl: null, bio: '',
});

async function publishOne(ctx: { db: any }, authorId: string, categoryId: string, title: string) {
  const a = await createArticle(ctx.db, authorId, { title, bodyMd: '本文', categoryId, tags: [] });
  await publishArticle(ctx.db, a.id, asUser(authorId));
  return a;
}

describe('article read', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('フィードは公開記事のみを新しい順で返す', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    await createArticle(ctx.db, u.id, { title: '下書き', bodyMd: '', categoryId: c.id, tags: [] });
    await publishOne(ctx, u.id, c.id, '公開1');
    await publishOne(ctx, u.id, c.id, '公開2');
    const page = await listFeed(ctx.db, { limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['公開2', '公開1']);
  });

  it('カテゴリ一覧は子カテゴリの記事も含む', async () => {
    const u = await createTestUser(ctx.db);
    const parent = await createTestCategory(ctx.db, { name: '親' });
    const child = await createTestCategory(ctx.db, { name: '子', parentId: parent.id });
    await publishOne(ctx, u.id, child.id, '子の記事');
    const page = await listByCategory(ctx.db, parent.id, { limit: 20 });
    expect(page.items.map((i) => i.title)).toEqual(['子の記事']);
  });

  it('下書きは著者のみ閲覧可、他人は NOT_FOUND', async () => {
    const author = await createTestUser(ctx.db);
    const other = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    const a = await createArticle(ctx.db, author.id, { title: '秘密', bodyMd: '', categoryId: c.id, tags: [] });
    expect((await getArticleForViewer(ctx.db, a.id, asUser(author.id))).title).toBe('秘密');
    await expect(getArticleForViewer(ctx.db, a.id, asUser(other.id))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('カーソルページングで続きを取得できる', async () => {
    const u = await createTestUser(ctx.db);
    const c = await createTestCategory(ctx.db);
    for (let i = 0; i < 3; i++) await publishOne(ctx, u.id, c.id, `記事${i}`);
    const p1 = await listFeed(ctx.db, { limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listFeed(ctx.db, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/article-service.read.test.ts`
Expected: FAIL

- [ ] **Step 2: 実装（`article-service.ts` に追記。冒頭の import に `desc`, `lt`, `or`, `sql`, `inArray` と `categories`, `tags`, `articleTags`, `users` を追加）**

先頭 import を次のように拡張:
```ts
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { articleRevisions, articles, articleTags, categories, tags, users } from '../db/schema';
```

`export { getArticleTagNames };` の直前に追記:
```ts
export type ArticleListItem = {
  id: string;
  title: string;
  excerpt: string;
  authorId: string;
  authorName: string;
  categoryId: string | null;
  pinnedAt: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type ArticleDetail = ArticleRecord & { authorName: string; tags: string[] };

const LIST_COLUMNS = {
  id: articles.id,
  title: articles.title,
  excerpt: sql<string>`left(${articles.searchText}, 160)`,
  authorId: articles.authorId,
  authorName: users.displayName,
  categoryId: articles.categoryId,
  pinnedAt: articles.pinnedAt,
  publishedAt: articles.publishedAt,
  updatedAt: articles.updatedAt,
};

function encodeCursor(item: { publishedAt: Date | null; id: string }): string {
  return Buffer.from(`${item.publishedAt?.toISOString() ?? ''}|${item.id}`).toString('base64url');
}
function decodeCursor(cursor: string): { publishedAt: string; id: string } {
  const [publishedAt, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  return { publishedAt, id };
}

async function pagePublished(
  db: Db,
  extraWhere: ReturnType<typeof and>,
  page: { cursor?: string; limit: number },
): Promise<Page<ArticleListItem>> {
  const base = and(eq(articles.status, 'published'), isNull(articles.deletedAt), extraWhere);
  const where = page.cursor
    ? and(
        base,
        (() => {
          const c = decodeCursor(page.cursor!);
          return or(
            lt(articles.publishedAt, new Date(c.publishedAt)),
            and(eq(articles.publishedAt, new Date(c.publishedAt)), lt(articles.id, c.id)),
          );
        })(),
      )
    : base;
  const rows = await db
    .select(LIST_COLUMNS)
    .from(articles)
    .innerJoin(users, eq(articles.authorId, users.id))
    .where(where)
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const nextCursor = rows.length > page.limit ? encodeCursor(items[items.length - 1]) : null;
  return { items, nextCursor };
}

export function listFeed(db: Db, page: { cursor?: string; limit: number }) {
  return pagePublished(db, undefined, page);
}

export async function listPickup(db: Db): Promise<ArticleListItem[]> {
  return db
    .select(LIST_COLUMNS)
    .from(articles)
    .innerJoin(users, eq(articles.authorId, users.id))
    .where(and(eq(articles.status, 'published'), isNull(articles.deletedAt), sql`${articles.pinnedAt} is not null`))
    .orderBy(desc(articles.pinnedAt));
}

export async function listByCategory(db: Db, categoryId: string, page: { cursor?: string; limit: number }) {
  const children = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, categoryId));
  const ids = [categoryId, ...children.map((c) => c.id)];
  return pagePublished(db, inArray(articles.categoryId, ids), page);
}

export async function listByTag(db: Db, tagName: string, page: { cursor?: string; limit: number }) {
  const ids = await db
    .select({ articleId: articleTags.articleId })
    .from(articleTags)
    .innerJoin(tags, eq(articleTags.tagId, tags.id))
    .where(eq(tags.name, tagName));
  const articleIds = ids.map((r) => r.articleId);
  if (articleIds.length === 0) return { items: [], nextCursor: null };
  return pagePublished(db, inArray(articles.id, articleIds), page);
}

export function listByAuthor(db: Db, authorId: string, page: { cursor?: string; limit: number }) {
  return pagePublished(db, eq(articles.authorId, authorId), page);
}

export async function listMine(
  db: Db,
  authorId: string,
  tab: 'draft' | 'published' | 'trash',
  page: { cursor?: string; limit: number },
): Promise<Page<ArticleListItem>> {
  const filter =
    tab === 'trash'
      ? and(eq(articles.authorId, authorId), sql`${articles.deletedAt} is not null`)
      : and(eq(articles.authorId, authorId), isNull(articles.deletedAt), eq(articles.status, tab));
  const rows = await db
    .select(LIST_COLUMNS)
    .from(articles)
    .innerJoin(users, eq(articles.authorId, users.id))
    .where(filter)
    .orderBy(desc(articles.updatedAt), desc(articles.id))
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const nextCursor = rows.length > page.limit ? encodeCursor(items[items.length - 1]) : null;
  return { items, nextCursor };
}

export async function getArticleForViewer(
  db: Db,
  id: string,
  viewer: SessionUser,
): Promise<ArticleDetail> {
  const row = await db.query.articles.findFirst({ where: eq(articles.id, id) });
  if (!row) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  const isOwnerOrAdmin = viewer.role === 'admin' || viewer.id === row.authorId;
  const visible = row.status === 'published' && !row.deletedAt;
  if (!visible && !isOwnerOrAdmin) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  const [author] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, row.authorId));
  const tagNames = await getArticleTagNames(db, id);
  return { ...row, authorName: author?.name ?? '', tags: tagNames };
}

export async function listRevisions(db: Db, id: string, editor: SessionUser) {
  const row = await db.query.articles.findFirst({ where: eq(articles.id, id) });
  if (!row) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
  if (!can(editor, 'article:edit', { authorId: row.authorId })) {
    throw new AppError('FORBIDDEN', '権限がありません', 403);
  }
  return db
    .select({ id: articleRevisions.id, title: articleRevisions.title, savedAt: articleRevisions.savedAt })
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, id))
    .orderBy(desc(articleRevisions.savedAt));
}
```

- [ ] **Step 3: テスト**

Run: `pnpm --filter @knowledge-hub/server test src/services/article-service.read.test.ts`
Expected: PASS（4 件）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add article read queries with cursor pagination"
```

---

### Task 10: カテゴリ・タグ ルート

**Files:**
- Create: `apps/server/src/routes/categories.ts`, `apps/server/src/routes/tags.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/routes/categories.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/categories` → 200 CategoryNode[]（認証必須）
  - `POST /api/categories`（admin）→ 200 Category、`PATCH /api/categories/:id`（admin）→ 200、`DELETE /api/categories/:id`（admin, body: `{ reassignToId? }`）→ 204
  - `GET /api/tags/popular` → 200 `{ name; count }[]`
- Consumes: Task 5/6 のサービス、Task 3 `requireAdmin`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/routes/categories.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('category routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function login(email: string, role: 'member' | 'admin'): Promise<string> {
    await createTestUser(ctx.db, { email, role });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }

  it('member は作成不可（403）、admin は作成可', async () => {
    const member = await login('m@example.com', 'member');
    const admin = await login('a@example.com', 'admin');
    expect(
      (await ctx.app.request('/api/categories', {
        method: 'POST', body: JSON.stringify({ name: 'テック' }),
        headers: { 'content-type': 'application/json', cookie: member },
      })).status,
    ).toBe(403);
    const res = await ctx.app.request('/api/categories', {
      method: 'POST', body: JSON.stringify({ name: 'テック' }),
      headers: { 'content-type': 'application/json', cookie: admin },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('テック');
  });

  it('ツリーを取得できる', async () => {
    const admin = await login('a@example.com', 'admin');
    await ctx.app.request('/api/categories', {
      method: 'POST', body: JSON.stringify({ name: 'テック' }),
      headers: { 'content-type': 'application/json', cookie: admin },
    });
    const res = await ctx.app.request('/api/categories', { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    expect((await res.json()).length).toBe(1);
  });

  it('カテゴリの記事一覧エンドポイントが Page を返す', async () => {
    const admin = await login('a@example.com', 'admin');
    const created = await (await ctx.app.request('/api/categories', {
      method: 'POST', body: JSON.stringify({ name: 'テック' }),
      headers: { 'content-type': 'application/json', cookie: admin },
    })).json();
    const res = await ctx.app.request(`/api/categories/${created.id}/articles`, { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page).toHaveProperty('items');
    expect(page).toHaveProperty('nextCursor');
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/routes/categories.test.ts`
Expected: FAIL

- [ ] **Step 2: ルートを実装**

`apps/server/src/routes/categories.ts`（`/:id/articles` は member も閲覧できるよう admin ガードの外に置く。静的でない `/:id` 系より前に、記事一覧を含めて定義順に注意）:
```ts
import { Hono } from 'hono';
import {
  categoryCreateSchema, categoryDeleteSchema, categoryUpdateSchema, listQuerySchema,
} from '@knowledge-hub/shared';
import { requireAdmin } from '../middleware/admin';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { listByCategory } from '../services/article-service';
import {
  createCategory, deleteCategory, listCategoryTree, updateCategory,
} from '../services/category-service';
import type { AppEnv } from '../types';

export const categoryRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', async (c) => c.json(await listCategoryTree(c.get('db'))))
  .get('/:id/articles', validate('query', listQuerySchema), async (c) =>
    c.json(await listByCategory(c.get('db'), c.req.param('id'), c.req.valid('query'))),
  )
  .post('/', requireAdmin, validate('json', categoryCreateSchema), async (c) =>
    c.json(await createCategory(c.get('db'), c.req.valid('json'))),
  )
  .patch('/:id', requireAdmin, validate('json', categoryUpdateSchema), async (c) =>
    c.json(await updateCategory(c.get('db'), c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/:id', requireAdmin, validate('json', categoryDeleteSchema), async (c) => {
    await deleteCategory(c.get('db'), c.req.param('id'), c.req.valid('json').reassignToId ?? null);
    return c.body(null, 204);
  });
```

`apps/server/src/routes/tags.ts`:
```ts
import { Hono } from 'hono';
import { listQuerySchema } from '@knowledge-hub/shared';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { listByTag } from '../services/article-service';
import { listPopularTags } from '../services/tag-service';
import type { AppEnv } from '../types';

export const tagRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/popular', async (c) => c.json(await listPopularTags(c.get('db'))))
  .get('/:name/articles', validate('query', listQuerySchema), async (c) =>
    c.json(await listByTag(c.get('db'), c.req.param('name'), c.req.valid('query'))),
  );
```

`apps/server/src/app.ts` に import と `.route()` を追加:
```ts
import { categoryRoutes } from './routes/categories';
import { tagRoutes } from './routes/tags';
// ...チェーンに追記
    .route('/api/categories', categoryRoutes)
    .route('/api/tags', tagRoutes)
```

- [ ] **Step 3: テスト**

Run: `pnpm --filter @knowledge-hub/server test src/routes/categories.test.ts`
Expected: PASS（3 件）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add category and tag routes"
```

---

### Task 11: 記事ルート

**Files:**
- Create: `apps/server/src/routes/articles.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/routes/articles.test.ts`

**Interfaces:**
- Produces（すべて requireAuth。`GET /:id` 以外は本文/クエリを Zod 検証）:
  - `POST /api/articles`（createArticleSchema）→ 200 ArticleRecord
  - `GET /api/articles`（listQuerySchema, query）→ 200 Page（フィード）
  - `GET /api/articles/pickup` → 200 ArticleListItem[]
  - `GET /api/articles/mine`（query: tab, listQuery）→ 200 Page
  - `GET /api/articles/:id` → 200 ArticleDetail（可視性は service 判定）
  - `PATCH /api/articles/:id`（updateArticleSchema）→ 200 ArticleRecord
  - `POST /api/articles/:id/publish` / `/unpublish` → 200 ArticleRecord
  - `DELETE /api/articles/:id` → 204（論理削除）、`POST /api/articles/:id/restore` → 204、`DELETE /api/articles/:id/purge` → 204
  - `POST /api/articles/:id/pin` / `/unpin` → 200 ArticleRecord
- Consumes: Task 7-9 のサービス、shared スキーマ

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/routes/articles.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('article routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function login(email: string, role: 'member' | 'admin' = 'member'): Promise<string> {
    await createTestUser(ctx.db, { email, role });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }
  const j = (cookie: string, body: unknown, method = 'POST') => ({
    method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie },
  });

  it('作成→公開→フィード表示までを通す', async () => {
    const cookie = await login('a@example.com');
    const cat = await createTestCategory(ctx.db);
    const created = await ctx.app.request('/api/articles', j(cookie, {
      title: 'AWS 入門', bodyMd: '本文', categoryId: cat.id, tags: ['AWS'],
    }));
    expect(created.status).toBe(200);
    const article = await created.json();
    const pub = await ctx.app.request(`/api/articles/${article.id}/publish`, j(cookie, {}));
    expect(pub.status).toBe(200);
    const feed = await ctx.app.request('/api/articles', { headers: { cookie } });
    expect((await feed.json()).items.map((i: { title: string }) => i.title)).toContain('AWS 入門');
  });

  it('他人の下書きは 404', async () => {
    const author = await login('author@example.com');
    const cat = await createTestCategory(ctx.db);
    const created = await (await ctx.app.request('/api/articles', j(author, {
      title: '秘密', bodyMd: '', categoryId: cat.id, tags: [],
    }))).json();
    const other = await login('other@example.com');
    const res = await ctx.app.request(`/api/articles/${created.id}`, { headers: { cookie: other } });
    expect(res.status).toBe(404);
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/routes/articles.test.ts`
Expected: FAIL

- [ ] **Step 2: ルートを実装**

`apps/server/src/routes/articles.ts`:
```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { createArticleSchema, listQuerySchema, updateArticleSchema } from '@knowledge-hub/shared';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import {
  createArticle, getArticleForViewer, listFeed, listMine, listPickup,
  publishArticle, purgeArticle, restoreArticle, setPinned, softDeleteArticle,
  updateArticle, unpublishArticle,
} from '../services/article-service';
import type { AppEnv } from '../types';

const mineQuerySchema = listQuerySchema.extend({
  tab: z.enum(['draft', 'published', 'trash']).default('draft'),
});

export const articleRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .post('/', validate('json', createArticleSchema), async (c) =>
    c.json(await createArticle(c.get('db'), c.get('user').id, c.req.valid('json'))),
  )
  .get('/', validate('query', listQuerySchema), async (c) =>
    c.json(await listFeed(c.get('db'), c.req.valid('query'))),
  )
  .get('/pickup', async (c) => c.json(await listPickup(c.get('db'))))
  .get('/mine', validate('query', mineQuerySchema), async (c) => {
    const { tab, ...page } = c.req.valid('query');
    return c.json(await listMine(c.get('db'), c.get('user').id, tab, page));
  })
  .get('/:id', async (c) => c.json(await getArticleForViewer(c.get('db'), c.req.param('id'), c.get('user'))))
  .patch('/:id', validate('json', updateArticleSchema), async (c) =>
    c.json(await updateArticle(c.get('db'), c.req.param('id'), c.get('user'), c.req.valid('json'))),
  )
  .post('/:id/publish', async (c) =>
    c.json(await publishArticle(c.get('db'), c.req.param('id'), c.get('user'))),
  )
  .post('/:id/unpublish', async (c) =>
    c.json(await unpublishArticle(c.get('db'), c.req.param('id'), c.get('user'))),
  )
  .delete('/:id', async (c) => {
    await softDeleteArticle(c.get('db'), c.req.param('id'), c.get('user'));
    return c.body(null, 204);
  })
  .post('/:id/restore', async (c) => {
    await restoreArticle(c.get('db'), c.req.param('id'), c.get('user'));
    return c.body(null, 204);
  })
  .delete('/:id/purge', async (c) => {
    await purgeArticle(c.get('db'), c.req.param('id'), c.get('user'));
    return c.body(null, 204);
  })
  .post('/:id/pin', async (c) =>
    c.json(await setPinned(c.get('db'), c.req.param('id'), c.get('user'), true)),
  )
  .post('/:id/unpin', async (c) =>
    c.json(await setPinned(c.get('db'), c.req.param('id'), c.get('user'), false)),
  );
```

`apps/server/src/app.ts` に追加:
```ts
import { articleRoutes } from './routes/articles';
// チェーンに追記
    .route('/api/articles', articleRoutes)
```

（注意: `GET /:id` より前に `/pickup` と `/mine` を定義しているため、静的パスが優先される。順序を変えないこと。）

- [ ] **Step 3: テスト**

Run: `pnpm --filter @knowledge-hub/server test src/routes/articles.test.ts`
Expected: PASS（2 件）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add article routes with full lifecycle"
```

---

### Task 12: ストレージ抽象・画像アップロード/配信

**Files:**
- Create: `apps/server/src/services/storage.ts`, `apps/server/src/services/upload-service.ts`, `apps/server/src/routes/uploads.ts`
- Modify: `apps/server/src/config.ts`, `apps/server/src/types.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/src/test/helpers.ts`, `apps/server/package.json`（`@aws-sdk/client-s3` 追加）, ルート直下 `.env.example`
- Test: `apps/server/src/routes/uploads.test.ts`

**Interfaces:**
- Produces:
  - `type Storage = { put(key, body: Buffer, contentType: string): Promise<void>; get(key): Promise<{ body: Buffer; contentType: string } | null> }`
  - `createS3Storage(config): Storage`（S3 互換。MinIO 対応の endpoint / forcePathStyle）
  - `createFakeStorage(): Storage & { store: Map<...> }`（テスト用、helpers に置く）
  - `saveUpload(db, storage, uploaderId, file: { buffer; mimeType; size }): Promise<{ id; url }>`（画像 MIME のみ・サイズ上限 10MB。違反は VALIDATION 400）
  - `getUpload(db, storage, id): Promise<{ body; contentType } | null>`
  - HTTP: `POST /api/uploads`（requireAuth, multipart `file`）→ 200 `{ id, url }`、`GET /api/uploads/:id`（requireAuth）→ 200 画像バイナリ
  - `AppEnv.Variables` に `storage: Storage` を追加、`buildApp` の deps に `storage`
- Consumes: Task 2 `uploads`

- [ ] **Step 1: 依存追加と config**

`apps/server/package.json` の dependencies に追加し install:
```
"@aws-sdk/client-s3": "^3.700.0"
```
Run: `pnpm install`

`apps/server/src/config.ts` の `envSchema` と `Config` と `loadConfig` に S3 設定を追加:
```ts
// envSchema に追記
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('knowledge-hub'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
```
```ts
// Config 型に追記
  s3Endpoint?: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3ForcePathStyle: boolean;
```
```ts
// loadConfig の戻りに追記
    s3Endpoint: e.S3_ENDPOINT,
    s3Region: e.S3_REGION,
    s3Bucket: e.S3_BUCKET,
    s3AccessKeyId: e.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: e.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: e.S3_FORCE_PATH_STYLE === 'true',
```

ルート直下 `.env.example` に追記:
```
# 画像ストレージ（オンプレ=MinIO / AWS=S3。差分は値のみ）
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=knowledge-hub
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
```

- [ ] **Step 2: Storage 実装と DI 配線**

`apps/server/src/services/storage.ts`:
```ts
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config';

export type Storage = {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
};

export function createS3Storage(config: Config): Storage {
  const client = new S3Client({
    region: config.s3Region,
    endpoint: config.s3Endpoint,
    forcePathStyle: config.s3ForcePathStyle,
    credentials: { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey },
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: config.s3Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }));
        const bytes = await res.Body!.transformToByteArray();
        return { body: Buffer.from(bytes), contentType: res.ContentType ?? 'application/octet-stream' };
      } catch {
        return null;
      }
    },
  };
}
```

`apps/server/src/types.ts` を更新（`Storage` を re-export、`AppEnv` に追加）:
```ts
import type { Config } from './config';
import type { SessionUser } from '@knowledge-hub/shared';
import type { Db } from './db/client';
import type { Mailer } from './services/mailer';
import type { Storage } from './services/storage';

export type AppEnv = {
  Variables: { db: Db; config: Config; mailer: Mailer; storage: Storage; user: SessionUser };
};
export type { Db, Mailer, Storage };
```

`apps/server/src/app.ts` の `buildApp` deps と set を更新:
```ts
export function buildApp(deps: { db: Db; config: Config; mailer: Mailer; storage: Storage }) {
  return new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('db', deps.db);
      c.set('config', deps.config);
      c.set('mailer', deps.mailer);
      c.set('storage', deps.storage);
      await next();
    })
    // ...既存の .use / .route はそのまま、末尾に uploads を追加（Step 4）
```
（import に `import type { AppEnv, Db, Mailer, Storage } from './types';` の `Storage` を追加）

`apps/server/src/index.ts` に storage を注入:
```ts
import { createS3Storage } from './services/storage';
// ...
const app = buildApp({ db, config, mailer: createSmtpMailer(config), storage: createS3Storage(config) });
```

`apps/server/src/test/helpers.ts` に Fake storage を追加し `createTestApp` に注入:
```ts
import type { Db, Mailer, Storage } from '../types';

export function createFakeStorage(): Storage & { store: Map<string, { body: Buffer; contentType: string }> } {
  const store = new Map<string, { body: Buffer; contentType: string }>();
  return {
    store,
    async put(key, body, contentType) { store.set(key, { body, contentType }); },
    async get(key) { return store.get(key) ?? null; },
  };
}
```
`createTestApp` を更新:
```ts
export function createTestApp() {
  const pool = new pg.Pool({ connectionString: inject('dbUrl') });
  const db: Db = drizzle(pool, { schema });
  const mailer = createFakeMailer();
  const storage = createFakeStorage();
  const app = buildApp({ db, config: testConfig(), mailer, storage });
  return { app, db, pool, mailer, storage };
}
```
`testConfig()` の戻りに S3 既定を追記:
```ts
    s3Region: 'us-east-1',
    s3Bucket: 'test',
    s3AccessKeyId: 'test',
    s3SecretAccessKey: 'test',
    s3ForcePathStyle: true,
```

- [ ] **Step 3: UploadService と失敗するルートテスト**

`apps/server/src/services/upload-service.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { uploads } from '../db/schema';
import { AppError } from '../errors';
import type { Db, Storage } from '../types';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_SIZE = 10 * 1024 * 1024;
const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};

export async function saveUpload(
  db: Db,
  storage: Storage,
  uploaderId: string,
  file: { buffer: Buffer; mimeType: string; size: number },
): Promise<{ id: string; url: string }> {
  if (!ALLOWED.has(file.mimeType)) throw new AppError('VALIDATION', '画像のみアップロードできます', 400);
  if (file.size > MAX_SIZE) throw new AppError('VALIDATION', 'ファイルサイズが大きすぎます（上限10MB）', 400);
  const id = randomUUID();
  const key = `uploads/${id}.${EXT[file.mimeType]}`;
  await storage.put(key, file.buffer, file.mimeType);
  await db.insert(uploads).values({ id, uploaderId, storageKey: key, mimeType: file.mimeType, size: file.size });
  return { id, url: `/api/uploads/${id}` };
}

export async function getUpload(
  db: Db,
  storage: Storage,
  id: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const row = await db.query.uploads.findFirst({ where: eq(uploads.id, id) });
  if (!row) return null;
  return storage.get(row.storageKey);
}
```

`apps/server/src/routes/uploads.ts`:
```ts
import { Hono } from 'hono';
import { requireAuth } from '../middleware/session';
import { getUpload, saveUpload } from '../services/upload-service';
import { AppError } from '../errors';
import type { AppEnv } from '../types';

export const uploadRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .post('/', async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new AppError('VALIDATION', 'ファイルが指定されていません', 400);
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await saveUpload(c.get('db'), c.get('storage'), c.get('user').id, {
      buffer, mimeType: file.type, size: buffer.length,
    });
    return c.json(result);
  })
  .get('/:id', async (c) => {
    const found = await getUpload(c.get('db'), c.get('storage'), c.req.param('id'));
    if (!found) throw new AppError('NOT_FOUND', '画像が見つかりません', 404);
    c.header('Content-Type', found.contentType);
    c.header('Cache-Control', 'private, max-age=86400');
    return c.body(found.body);
  });
```

`apps/server/src/app.ts` に `.route('/api/uploads', uploadRoutes)` を追加（import も）。

`apps/server/src/routes/uploads.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('upload routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function login(): Promise<string> {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com', password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }

  it('画像をアップロードして取得できる', async () => {
    const cookie = await login();
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
    const up = await ctx.app.request('/api/uploads', { method: 'POST', body: fd, headers: { cookie } });
    expect(up.status).toBe(200);
    const { id, url } = await up.json();
    expect(url).toBe(`/api/uploads/${id}`);
    const get = await ctx.app.request(url, { headers: { cookie } });
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
  });

  it('画像以外は 400', async () => {
    const cookie = await login();
    const fd = new FormData();
    fd.append('file', new File(['hello'], 'x.txt', { type: 'text/plain' }));
    const up = await ctx.app.request('/api/uploads', { method: 'POST', body: fd, headers: { cookie } });
    expect(up.status).toBe(400);
  });

  it('未認証は 401', async () => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1])], 'x.png', { type: 'image/png' }));
    expect((await ctx.app.request('/api/uploads', { method: 'POST', body: fd })).status).toBe(401);
  });
});
```

- [ ] **Step 4: テスト（全体）**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add s3-compatible storage and image upload endpoints"
```

---

### Task 13: Web 依存追加・Markdown ビュー・記事詳細画面

**Files:**
- Modify: `apps/web/package.json`（`react-markdown` / `remark-gfm` / `rehype-sanitize` 追加）, `apps/web/src/App.tsx`（ルート追加）
- Create: `apps/web/src/lib/markdown.tsx`, `apps/web/src/pages/ArticleDetailPage.tsx`, `apps/web/src/api/articles.ts`
- Test: `apps/web/src/lib/markdown.test.tsx`

**Interfaces:**
- Produces: `<Markdown source={string} />`（サニタイズ済みレンダリング）, `ArticleDetailPage`, 記事系 query/mutation フック（`useArticle` 等）
- Consumes: Phase 1 の `api`（`hc<AppType>`、Phase 2a のルートが型として現れる）, `useMe`

- [ ] **Step 1: 依存追加**

`apps/web/package.json` の dependencies に追加し install:
```
"react-markdown": "^9.0.1",
"remark-gfm": "^4.0.0",
"rehype-sanitize": "^6.0.0"
```
Run: `pnpm install`

- [ ] **Step 2: Markdown ビューの失敗テスト**

`apps/web/src/lib/markdown.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

describe('Markdown', () => {
  it('見出しと本文をレンダリングする', () => {
    render(<Markdown source={'# タイトル\n\n本文テキスト'} />);
    expect(screen.getByRole('heading', { name: 'タイトル' })).toBeInTheDocument();
    expect(screen.getByText('本文テキスト')).toBeInTheDocument();
  });

  it('生の script は描画されない（サニタイズ）', () => {
    render(<Markdown source={'<script>alert(1)</script>安全'} />);
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/安全/)).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @knowledge-hub/web test src/lib/markdown.test.tsx`
Expected: FAIL

- [ ] **Step 3: Markdown ビュー実装**

`apps/web/src/lib/markdown.tsx`:
```tsx
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

export function Markdown({ source }: { source: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 4: 記事 API フックと詳細画面**

`apps/web/src/api/articles.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export function useArticle(id: string) {
  return useQuery({
    queryKey: ['article', id],
    queryFn: async () => {
      const res = await api.api.articles[':id'].$get({ param: { id } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });
}
```

`apps/web/src/pages/ArticleDetailPage.tsx`:
```tsx
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useArticle } from '../api/articles';
import { useMe } from '../auth/useMe';
import { Markdown } from '../lib/markdown';

export function ArticleDetailPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const { data: article, isLoading } = useArticle(id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  if (isLoading) return <p>読み込み中…</p>;
  if (!article) return <p>記事が見つかりません。</p>;

  const canEdit = me && (me.role === 'admin' || me.id === article.authorId);
  const canPin = me?.role === 'admin' && article.status === 'published';

  async function togglePin() {
    await api.api.articles[':id'][article!.pinnedAt ? 'unpin' : 'pin'].$post({ param: { id } });
    await queryClient.invalidateQueries({ queryKey: ['article', id] });
  }

  return (
    <article>
      {article.status === 'draft' && <p className="badge">下書き</p>}
      {article.deletedAt && <p className="badge">削除済み</p>}
      <h1>{article.title}</h1>
      <p className="meta">
        {article.authorName}
        {article.tags.length > 0 && (
          <span> ・ {article.tags.map((t) => <Link key={t} to={`/tags/${encodeURIComponent(t)}`}>#{t}</Link>)}</span>
        )}
      </p>
      {canEdit && <Link to={`/articles/${id}/edit`}>編集</Link>}
      {canPin && <button type="button" onClick={togglePin}>{article.pinnedAt ? 'ピン解除' : 'ピン留め'}</button>}
      {canEdit && (
        <button
          type="button"
          onClick={async () => {
            await api.api.articles[':id'].$delete({ param: { id } });
            navigate('/me/articles');
          }}
        >
          ゴミ箱へ
        </button>
      )}
      <Markdown source={article.bodyMd} />
    </article>
  );
}
```

`apps/web/src/App.tsx` の保護ルート `children` に追加:
```tsx
      { path: '/articles/:id', element: <ArticleDetailPage /> },
```
（import 追加）

- [ ] **Step 5: テスト**

Run: `pnpm --filter @knowledge-hub/web test src/lib/markdown.test.tsx && pnpm --filter @knowledge-hub/web typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add markdown viewer and article detail page"
```

---

### Task 14: トップフィード・カテゴリ・タグ・マイ記事の一覧画面

**Files:**
- Create: `apps/web/src/components/{ArticleCard.tsx,ArticleList.tsx}`, `apps/web/src/pages/{CategoryPage.tsx,TagPage.tsx,MyArticlesPage.tsx}`
- Modify: `apps/web/src/pages/HomePage.tsx`（差し替え）, `apps/web/src/App.tsx`（ルート追加）, `apps/web/src/styles.css`（一覧用スタイル追記）
- Test: `apps/web/src/components/ArticleCard.test.tsx`

**Interfaces:**
- Produces: `ArticleCard`（1 記事の要約カード）, `ArticleList`（items + 「もっと見る」）, 各一覧ページ
- Consumes: Task 11 の記事一覧 API（`api.api.articles.$get` 等）

- [ ] **Step 1: ArticleCard の失敗テスト**

`apps/web/src/components/ArticleCard.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ArticleCard } from './ArticleCard';

describe('ArticleCard', () => {
  it('タイトルと著者を表示しリンクする', () => {
    render(
      <MemoryRouter>
        <ArticleCard item={{
          id: 'a1', title: '記事タイトル', excerpt: '要約', authorId: 'u1', authorName: '太郎',
          categoryId: null, pinnedAt: null, publishedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
        }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /記事タイトル/ })).toHaveAttribute('href', '/articles/a1');
    expect(screen.getByText('太郎')).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @knowledge-hub/web test src/components/ArticleCard.test.tsx`
Expected: FAIL

- [ ] **Step 2: 共有コンポーネント実装**

`apps/web/src/components/ArticleCard.tsx`:
```tsx
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
```

`apps/web/src/components/ArticleList.tsx`:
```tsx
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
```

- [ ] **Step 3: 各ページ実装**

`apps/web/src/pages/HomePage.tsx`（差し替え。ピックアップ + フィード）:
```tsx
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api/client';
import { ArticleCard, type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';

export function HomePage() {
  const pickup = useQuery({
    queryKey: ['pickup'],
    queryFn: async () => {
      const res = await api.api.articles.pickup.$get();
      return res.ok ? ((await res.json()) as ArticleItem[]) : [];
    },
  });
  const feed = useInfiniteQuery({
    queryKey: ['feed'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.articles.$get({ query: pageParam ? { cursor: pageParam } : {} });
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (feed.data?.pages ?? []).flatMap((p) => p.items) as ArticleItem[];

  return (
    <div>
      <Link to="/articles/new" className="primary-link">記事を書く</Link>
      {(pickup.data ?? []).length > 0 && (
        <section>
          <h2>ピックアップ</h2>
          <div className="article-list">
            {pickup.data!.map((it) => <ArticleCard key={it.id} item={it} />)}
          </div>
        </section>
      )}
      <section>
        <h2>新着</h2>
        <ArticleList items={items} hasMore={!!feed.hasNextPage} onLoadMore={() => feed.fetchNextPage()} />
      </section>
    </div>
  );
}
```

`apps/web/src/pages/CategoryPage.tsx`:
```tsx
import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../api/client';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';

export function CategoryPage() {
  const { id = '' } = useParams();
  const q = useInfiniteQuery({
    queryKey: ['category', id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.categories[':id'].articles.$get({
        param: { id }, query: pageParam ? { cursor: pageParam } : {},
      });
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items) as ArticleItem[];
  return (
    <section>
      <h2>カテゴリ</h2>
      <ArticleList items={items} hasMore={!!q.hasNextPage} onLoadMore={() => q.fetchNextPage()} />
    </section>
  );
}
```
（このページは `GET /api/categories/:id/articles`（Task 10 で定義済み）を使う。）

`apps/web/src/pages/TagPage.tsx`:
```tsx
import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../api/client';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';

export function TagPage() {
  const { name = '' } = useParams();
  const q = useInfiniteQuery({
    queryKey: ['tag', name],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.tags[':name'].articles.$get({
        param: { name }, query: pageParam ? { cursor: pageParam } : {},
      });
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items) as ArticleItem[];
  return (
    <section>
      <h2>#{name}</h2>
      <ArticleList items={items} hasMore={!!q.hasNextPage} onLoadMore={() => q.fetchNextPage()} />
    </section>
  );
}
```

`apps/web/src/pages/MyArticlesPage.tsx`:
```tsx
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { type ArticleItem } from '../components/ArticleCard';
import { ArticleList } from '../components/ArticleList';

const TABS = [
  { key: 'draft', label: '下書き' },
  { key: 'published', label: '公開済み' },
  { key: 'trash', label: 'ゴミ箱' },
] as const;

export function MyArticlesPage() {
  const [tab, setTab] = useState<'draft' | 'published' | 'trash'>('draft');
  const q = useInfiniteQuery({
    queryKey: ['mine', tab],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.articles.mine.$get({
        query: { tab, ...(pageParam ? { cursor: pageParam } : {}) },
      });
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = (q.data?.pages ?? []).flatMap((p) => p.items) as ArticleItem[];
  return (
    <section>
      <h2>マイ記事</h2>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <ArticleList items={items} hasMore={!!q.hasNextPage} onLoadMore={() => q.fetchNextPage()} emptyText="記事がありません。" />
    </section>
  );
}
```

`apps/web/src/App.tsx` の保護ルート `children` に追加:
```tsx
      { path: '/categories/:id', element: <CategoryPage /> },
      { path: '/tags/:name', element: <TagPage /> },
      { path: '/me/articles', element: <MyArticlesPage /> },
```

`apps/web/src/styles.css` に追記:
```css
.article-list { display: flex; flex-direction: column; gap: 1rem; }
.article-card { border: 1px solid #d0d7de; border-radius: 8px; padding: 1rem; }
.article-card h3 { margin: 0 0 0.25rem; }
.article-card .excerpt { color: #57606a; margin: 0; }
.tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.tabs button[aria-pressed='true'] { background: #1f6feb; color: #fff; }
.badge { display: inline-block; background: #eaeef2; border-radius: 4px; padding: 0.1rem 0.5rem; font-size: 0.8rem; }
.markdown-body { line-height: 1.7; }
```

- [ ] **Step 4: テスト**

Run: `pnpm --filter @knowledge-hub/web test src/components/ArticleCard.test.tsx && pnpm --filter @knowledge-hub/web typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add feed, category, tag and my-articles pages"
```

---

### Task 15: Markdown ソースエディタ・カテゴリ管理画面・ナビ

**Files:**
- Modify: `apps/web/package.json`（`@uiw/react-codemirror` / `@codemirror/lang-markdown` 追加）, `apps/web/src/App.tsx`, `apps/web/src/components/Layout.tsx`（ナビリンク追加）
- Create: `apps/web/src/pages/EditorPage.tsx`, `apps/web/src/pages/AdminCategoriesPage.tsx`, `apps/web/src/components/{CategorySelect.tsx,TagInput.tsx}`
- Test: `apps/web/src/pages/EditorPage.test.tsx`

**Interfaces:**
- Produces: `EditorPage`（新規/編集、CodeMirror ソース、カテゴリ/タグ、自動保存、公開）, `AdminCategoriesPage`, `CategorySelect`, `TagInput`
- Consumes: Task 11 の記事 API、Task 10 のカテゴリ API

- [ ] **Step 1: 依存追加**

`apps/web/package.json` の dependencies に追加し install:
```
"@uiw/react-codemirror": "^4.23.6",
"@codemirror/lang-markdown": "^6.3.1"
```
Run: `pnpm install`

- [ ] **Step 2: EditorPage の失敗テスト**

`apps/web/src/pages/EditorPage.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const postMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-05T00:00:00Z' }) });
vi.mock('../api/client', () => ({
  api: {
    api: {
      articles: { $post: (...a: unknown[]) => postMock(...a) },
      categories: { $get: vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) },
    },
  },
}));

import { EditorPage } from './EditorPage';

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/articles/new']}>
        <EditorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EditorPage', () => {
  it('タイトル入力で下書きを作成する（POST 呼び出し）', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }));
    expect(postMock).toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @knowledge-hub/web test src/pages/EditorPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 補助コンポーネント**

`apps/web/src/components/CategorySelect.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

type Node = { id: string; name: string; children: Node[] };

export function CategorySelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await api.api.categories.$get();
      return res.ok ? ((await res.json()) as Node[]) : [];
    },
  });
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">（カテゴリ未設定）</option>
      {(data ?? []).map((parent) => (
        <optgroup key={parent.id} label={parent.name}>
          <option value={parent.id}>{parent.name}</option>
          {parent.children.map((child) => (
            <option key={child.id} value={child.id}>　{child.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
```

`apps/web/src/components/TagInput.tsx`:
```tsx
import { useState } from 'react';

export function TagInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  function add() {
    const t = text.trim();
    if (t && !value.includes(t) && value.length < 10) onChange([...value, t]);
    setText('');
  }
  return (
    <div className="tag-input">
      <div className="tag-chips">
        {value.map((t) => (
          <span key={t} className="chip">
            {t}
            <button type="button" aria-label={`${t} を削除`} onClick={() => onChange(value.filter((x) => x !== t))}>×</button>
          </span>
        ))}
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        placeholder="タグを入力して Enter"
      />
    </div>
  );
}
```

- [ ] **Step 4: EditorPage 実装**

`apps/web/src/pages/EditorPage.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { CategorySelect } from '../components/CategorySelect';
import { TagInput } from '../components/TagInput';

export function EditorPage() {
  const { id: routeId } = useParams();
  const [id, setId] = useState<string | null>(routeId ?? null);
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // 既存記事の読み込み
  useEffect(() => {
    if (!routeId) return;
    (async () => {
      const res = await api.api.articles[':id'].$get({ param: { id: routeId } });
      if (!res.ok) return;
      const a = await res.json();
      setTitle(a.title); setBodyMd(a.bodyMd); setCategoryId(a.categoryId); setTags(a.tags); setUpdatedAt(a.updatedAt);
    })();
  }, [routeId]);

  async function save() {
    setError(null);
    if (id && updatedAt) {
      const res = await api.api.articles[':id'].$patch({
        param: { id }, json: { title, bodyMd, categoryId, tags, expectedUpdatedAt: updatedAt },
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(b?.message ?? '保存に失敗しました');
        return;
      }
      const a = await res.json();
      setUpdatedAt(a.updatedAt); setStatus('保存しました');
    } else {
      const res = await api.api.articles.$post({ json: { title, bodyMd, categoryId, tags } });
      if (!res.ok) { setError('保存に失敗しました'); return; }
      const a = await res.json();
      setId(a.id); setUpdatedAt(a.updatedAt); setStatus('保存しました');
    }
  }

  // 自動保存（2 秒デバウンス。title が空の間は保存しない）
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!title.trim()) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, bodyMd, categoryId, tags]);

  async function publish() {
    if (!id) { await save(); }
    const target = id;
    if (!target) return;
    const res = await api.api.articles[':id'].publish.$post({ param: { id: target } });
    if (!res.ok) {
      const b = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(b?.message ?? '公開に失敗しました');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['feed'] });
    navigate(`/articles/${target}`);
  }

  return (
    <section className="editor">
      <label>タイトル<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>カテゴリ<CategorySelect value={categoryId} onChange={setCategoryId} /></label>
      <label>タグ<TagInput value={tags} onChange={setTags} /></label>
      <CodeMirror value={bodyMd} height="400px" extensions={[markdown()]} onChange={setBodyMd} />
      {error && <p role="alert" className="form-error">{error}</p>}
      {status && <p role="status">{status}</p>}
      <div className="editor-actions">
        <button type="button" onClick={save}>下書き保存</button>
        <button type="button" onClick={publish}>公開する</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: 管理カテゴリ画面とナビ・ルート**

`apps/web/src/pages/AdminCategoriesPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

type Node = { id: string; name: string; parentId: string | null; children: Node[] };

export function AdminCategoriesPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const { data: tree } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await api.api.categories.$get();
      return res.ok ? ((await res.json()) as Node[]) : [];
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const res = await api.api.categories.$post({ json: { name, parentId } });
      if (!res.ok) throw new Error('作成に失敗しました');
    },
    onSuccess: () => { setName(''); queryClient.invalidateQueries({ queryKey: ['categories'] }); },
    onError: (e) => alert(e.message),
  });
  function onSubmit(e: FormEvent) { e.preventDefault(); create.mutate(); }
  return (
    <section>
      <h2>カテゴリ管理</h2>
      <form onSubmit={onSubmit} className="auth-form">
        <label>名称<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>
          親カテゴリ
          <select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
            <option value="">（第1階層）</option>
            {(tree ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="submit">追加</button>
      </form>
      <ul>
        {(tree ?? []).map((p) => (
          <li key={p.id}>{p.name}
            {p.children.length > 0 && <ul>{p.children.map((c) => <li key={c.id}>{c.name}</li>)}</ul>}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`apps/web/src/components/Layout.tsx` の `<nav>` にリンクを追加（既存の管理/設定リンクの近く）:
```tsx
          <Link to="/me/articles">マイ記事</Link>
          {me?.role === 'admin' && <Link to="/admin/categories">カテゴリ</Link>}
```

`apps/web/src/App.tsx` の保護ルート `children` に追加（import も）:
```tsx
      { path: '/articles/new', element: <EditorPage /> },
      { path: '/articles/:id/edit', element: <EditorPage /> },
      { path: '/admin/categories', element: <AdminCategoriesPage /> },
```

`apps/web/src/styles.css` に追記:
```css
.editor { display: flex; flex-direction: column; gap: 1rem; }
.editor label { display: flex; flex-direction: column; gap: 0.25rem; }
.editor-actions { display: flex; gap: 0.5rem; }
.tag-chips { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.chip { background: #eaeef2; border-radius: 12px; padding: 0.1rem 0.5rem; }
.chip button { background: none; color: inherit; padding: 0 0 0 0.25rem; }
.primary-link { display: inline-block; margin-bottom: 1rem; font-weight: 600; }
```

- [ ] **Step 6: テスト + 全体確認**

Run: `pnpm --filter @knowledge-hub/web test && pnpm typecheck && pnpm test`
Expected: 全 PASS

手動 E2E（Phase 2a の受け入れ確認）:
1. `docker compose up -d`（MinIO を使う場合は別途 S3 互換ストレージを用意。無い場合、画像アップロードのみスキップ可）、server/web dev 起動
2. ログイン → 「記事を書く」→ タイトル・本文・カテゴリ・タグを入力 → 数秒後に「保存しました」（自動保存）
3. 「公開する」→ 記事詳細に遷移し、トップの新着フィードに出る
4. admin で記事詳細から「ピン留め」→ トップのピックアップに出る
5. カテゴリ/タグのリンクから該当一覧に遷移できる
6. マイ記事で下書き/公開済み/ゴミ箱のタブが機能する。ゴミ箱へ移動 → フィードから消える
7. admin の「カテゴリ」画面で親・子カテゴリを作成できる

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add markdown source editor and category admin ui"
```

---

## Self-Review（計画作成者による点検メモ）

- **spec カバレッジ**: §4 データモデル（articles/revisions/categories/tags/uploads → Task 2）、§5 権限（Task 3）、§6 エディタのソースモード（Task 15。リッチ Tiptap と往復テストは **Phase 2b** に送る）、§7 カテゴリ/画面（Task 5,10,14,15）、§8 ライフサイクル/ピックアップ/画像（Task 8,12,13）、§10 楽観ロック（Task 7）、§11 サニタイズ（Task 13）を割当済み。検索（pg_bigm）とコメント/リアクション/ブックマーク/通知は **Phase 3** のため本計画のスコープ外（search_text 列だけ Task 4 で先行populate）。
- **Phase 2b 予告**: Tiptap リッチ ⇔ Markdown 無損失往復、§6 全記法の往復テストスイート、画像 D&D/ペースト挿入。本計画で作った `Markdown` ビュー・`saveUpload`・エディタ骨格の上に載せる。
- **既知の前提**: 画像アップロードの統合テストは Fake storage で行い、実 S3/MinIO 配信は手動確認（Mailer と同方針）。オンプレで MinIO を使う場合の docker-compose への追加は運用判断（本計画では必須にしない）。
- **順序依存の注意**: 記事ルートの `GET /:id` はワイルドカードのため、`/pickup`・`/mine` を必ず先に定義する（Task 11 に明記）。カテゴリ/タグの記事一覧エンドポイントは Task 14 Step 3 の指示で Task 10 のルートに追記する。

---

## Execution Handoff

計画は `docs/superpowers/plans/2026-07-05-phase2a-articles-backend.md` に保存済み。実行方法は2択:

1. **Subagent-Driven（推奨）** — タスクごとに新しいサブエージェントを割り当て、タスク間でレビュー。Phase 1 と同じ進め方。
2. **Inline Execution** — このセッションで executing-plans に沿ってバッチ実行、チェックポイントでレビュー。


