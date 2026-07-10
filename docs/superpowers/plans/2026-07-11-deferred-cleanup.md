# 保留バックログ一掃 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 台帳の保留バックログ（サーバー統合リファクタ・サーバー Minor 修正・Web リファクタ/修正）を 3 ブランチで一括解消する。

**Architecture:** 純粋リファクタ（挙動不変）と挙動修正/契約変更をブランチで分離。ブランチ 1 `refactor/server-consolidation` は既存テスト無修正 green が合格条件。ブランチ 2 `fix/server-minors` は各修正に回帰テストを追加。ブランチ 3 `refactor/web-cleanup` は query-key ファクトリ（キャッシュ互換の純置換）+ hook 化 + 小修正。各ブランチは main から分岐し `--no-ff` でマージ。

**Tech Stack:** Hono + Drizzle + PostgreSQL（Testcontainers テスト）、React + TanStack Query + Vitest。

**Spec:** `docs/superpowers/specs/2026-07-11-deferred-cleanup-design.md`

## Global Constraints

- API レスポンス形状の変更は Task 7（comment mutation → `CommentItem`）のみ。他タスクは全レスポンス形状不変。
- query-key の実体配列は現状と同一（キャッシュ互換の純置換）。
- keyset カーソル述語の共通 helper 化はしない（スコープ外）。
- 通知は best-effort（`runNotify`）のままトランザクションの外。
- コミットは英語 Conventional Commits。main へ直接コミットしない。
- 各ブランチ完了時に `pnpm --filter @knowledge-hub/server test` / `pnpm --filter @knowledge-hub/web test` green、最終ゲートは `pnpm run verify` exit 0 + E2E フル。
- サーバーのサービステストは Docker（Testcontainers）前提。

---

## ブランチ 1: `refactor/server-consolidation`（Task 1〜3、挙動不変）

開始時に `git checkout main && git checkout -b refactor/server-consolidation`。

### Task 1: 記事カード列の基底定数化（ARTICLE_CARD_COLUMNS）

**Files:**
- Modify: `apps/server/src/services/article-service.ts`（`LIST_COLUMNS` を改名・export、~289 行）
- Modify: `apps/server/src/services/engagement-service.ts`（`BOOKMARK_COLUMNS` を spread に、~100 行）
- Modify: `apps/server/src/services/search-service.ts`（select を spread に、~100 行）

**Interfaces:**
- Produces: `export const ARTICLE_CARD_COLUMNS`（article-service。現 `LIST_COLUMNS` と同一内容: id/title/excerpt/authorId/authorName/categoryId/pinnedAt/publishedAt/updatedAt/heroImageUploadId/categoryName/authorAvatarUrl）
- 制約: engagement/search → article-service の import は既存方向（`fetchListMetadata` で既にこの向き）。循環なし。

- [ ] **Step 1: article-service の `LIST_COLUMNS` を `ARTICLE_CARD_COLUMNS` に改名して export**

```typescript
// apps/server/src/services/article-service.ts
// 記事カード（一覧 8 画面共通）の基底 select 列。bookmarks/search は
// spread + 差分宣言で再利用する（engagement-service / search-service 参照）。
export const ARTICLE_CARD_COLUMNS = {
  id: articles.id,
  title: articles.title,
  excerpt: sql<string>`left(${articles.searchText}, 160)`,
  authorId: articles.authorId,
  authorName: users.displayName,
  categoryId: articles.categoryId,
  pinnedAt: articles.pinnedAt,
  publishedAt: articles.publishedAt,
  updatedAt: articles.updatedAt,
  heroImageUploadId: articles.heroImageUploadId,
  categoryName: categories.name,
  authorAvatarUrl: users.avatarUrl,
};
```

ファイル内の `LIST_COLUMNS` 参照（`pagePublished` / `listPickup` / `listMine` の `.select(LIST_COLUMNS)` 3 箇所）をすべて `ARTICLE_CARD_COLUMNS` に置換する。

- [ ] **Step 2: engagement-service の `BOOKMARK_COLUMNS` を spread + 差分宣言に**

```typescript
// apps/server/src/services/engagement-service.ts
import { fetchListMetadata, ARTICLE_CARD_COLUMNS } from './article-service';

const BOOKMARK_COLUMNS = {
  ...ARTICLE_CARD_COLUMNS,
  bookmarkedAt: bookmarks.createdAt,
  // カーソルのタイブレークは bookmarks.id で行うため、articles.id とは別に保持する
  // （BOOKMARK_COLUMNS.id は API 形状用に articles.id を指しており、bookmarks.id と
  // 混同するとタイブレークが無関係な article id と比較される不具合になる）。
  bookmarkId: bookmarks.id,
};
```

（列の実体は変更前と 1 対 1 で同一。既存コメントは bookmarkId 側へ残す。）

- [ ] **Step 3: search-service の select を spread + 差分宣言に**

search のレスポンスは excerpt/pinnedAt を持たない（`snippet` を持つ）。基底から除外して組む:

```typescript
// apps/server/src/services/search-service.ts
import { fetchListMetadata, ARTICLE_CARD_COLUMNS } from './article-service';

// search は excerpt の代わりに snippet を返し、pinnedAt を持たない（既存 API 形状）
const { excerpt: _excerpt, pinnedAt: _pinnedAt, ...SEARCH_CARD_COLUMNS } = ARTICLE_CARD_COLUMNS;
```

既存の `.select({ id: articles.id, title: articles.title, snippet, ... })` を
`.select({ ...SEARCH_CARD_COLUMNS, snippet })` に置換。以降の mapping コードは無変更
（フィールド名が同一のため）。

- [ ] **Step 4: サーバーテストを実行して既存テスト無修正 green を確認**

Run: `pnpm --filter @knowledge-hub/server test`
Expected: 全件 PASS（既存テストの修正はこのタスクでは禁止。落ちたらリファクタが挙動を変えている）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/article-service.ts apps/server/src/services/engagement-service.ts apps/server/src/services/search-service.ts
git commit -m "refactor(server): share article card columns across list services"
```

### Task 2: mention 通知 2 関数の共通ヘルパー抽出

**Files:**
- Modify: `apps/server/src/services/notification-service.ts:50-129`

**Interfaces:**
- Consumes: 既存 `resolveMentionRecipients(db, bodyMd, actorId)`
- Produces: private `notifyFreshMentions`（export しない）。`notifyCommentMentionsOnEdit` / `notifyArticleMentions` の外部シグネチャ・挙動は不変。

- [ ] **Step 1: 共通ヘルパーを追加し 2 関数を委譲に書き換え**

`notifyCommentMentionsOnEdit` と `notifyArticleMentions` は「メンション解決 → 通知済み受信者を除外 → mention 通知 insert」が共通で、通知済み判定のスコープ条件と commentId の有無だけが違う。以下に置換:

```typescript
// apps/server/src/services/notification-service.ts
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

/**
 * 本文メンションのうち、notifiedScope 内で通知済み（種別・既読問わず）の相手を除いて
 * mention 通知を insert する共通処理。comment 編集と記事公開/更新で共有。
 */
async function notifyFreshMentions(
  db: Db,
  input: {
    bodyMd: string;
    actorId: string;
    articleId: string;
    commentId: string | null;
    notifiedScope: SQL;
  },
): Promise<void> {
  const recipients = await resolveMentionRecipients(db, input.bodyMd, input.actorId);
  if (recipients.length === 0) return;
  const existing = await db
    .select({ recipientId: notifications.recipientId })
    .from(notifications)
    .where(and(input.notifiedScope, inArray(notifications.recipientId, recipients)));
  const notified = new Set(existing.map((r) => r.recipientId));
  const fresh = recipients.filter((id) => !notified.has(id));
  if (fresh.length === 0) return;
  await db.insert(notifications).values(
    fresh.map((recipientId) => ({
      recipientId,
      type: 'mention' as const,
      actorId: input.actorId,
      articleId: input.articleId,
      ...(input.commentId ? { commentId: input.commentId } : {}),
    })),
  );
}

export async function notifyCommentMentionsOnEdit(
  db: Db,
  comment: { id: string; articleId: string; authorId: string; bodyMd: string },
): Promise<void> {
  // このコメントで既に通知（種別問わず・既読含む）済みの相手には再通知しない
  await notifyFreshMentions(db, {
    bodyMd: comment.bodyMd,
    actorId: comment.authorId,
    articleId: comment.articleId,
    commentId: comment.id,
    notifiedScope: eq(notifications.commentId, comment.id),
  });
}

export async function notifyArticleMentions(
  db: Db,
  article: { id: string; authorId: string; bodyMd: string },
): Promise<void> {
  // 同一記事で既に本文メンション通知（既読含む）済みの相手には再通知しない
  await notifyFreshMentions(db, {
    bodyMd: article.bodyMd,
    actorId: article.authorId,
    articleId: article.id,
    commentId: null,
    notifiedScope: and(
      eq(notifications.articleId, article.id),
      eq(notifications.type, 'mention'),
      isNull(notifications.commentId),
    )!,
  });
}
```

注意: `and(...)` の戻りは `SQL | undefined` なので `!` で絞る（引数は全て非 undefined のため実際には常に SQL）。`notifyCommentCreated` / `notifyReactionAdded` は dedupe 意味論が異なる（優先度マージ／未読のみ）ため対象外。

- [ ] **Step 2: サーバーテストを実行して既存テスト無修正 green を確認**

Run: `pnpm --filter @knowledge-hub/server test`
Expected: 全件 PASS（notification-wiring / notification-service のテストが挙動不変を担保）

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/services/notification-service.ts
git commit -m "refactor(server): extract shared fresh-mention notification helper"
```

### Task 3: articles ルートの `:id` 検証を per-route ミドルウェア化 + @types/nodemailer 要否確認

**Files:**
- Modify: `apps/server/src/routes/guards.ts`
- Modify: `apps/server/src/routes/articles.ts`（`requireUuidParam(c.req.param('id'), ...)` 9 箇所）
- Modify（条件付き）: `apps/server/package.json`

**Interfaces:**
- Produces: `export function uuidParam(name: string, notFoundMessage: string): MiddlewareHandler`（guards.ts）
- 既存 `requireUuidParam` は維持（他ルートが使用中）。

**設計判断（spec からの意図的調整）:** spec の「ルータレベルのミドルウェア（`.use('/:id')`）」は Hono では `/pickup` `/mine` などのリテラルパスにも `/:id` パターンがマッチしてガードが誤発動するため不可。per-route ミドルウェア（ハンドラ前段に挟む）で重複を除去する。spec 本文も同時に修正済み。

- [ ] **Step 1: guards.ts にミドルウェアファクトリを追加**

```typescript
// apps/server/src/routes/guards.ts
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { AppError } from '../errors';

const uuid = z.string().uuid();

// 不正な UUID 形式は DB エラー（22P02 → 500）ではなく NOT_FOUND として扱う
export function requireUuidParam(value: string, notFoundMessage: string): void {
  if (!uuid.safeParse(value).success) {
    throw new AppError('NOT_FOUND', notFoundMessage, 404);
  }
}

/** requireUuidParam の per-route ミドルウェア版。ハンドラ前段に挟んで使う。 */
export function uuidParam(name: string, notFoundMessage: string): MiddlewareHandler {
  return async (c, next) => {
    requireUuidParam(c.req.param(name), notFoundMessage);
    await next();
  };
}
```

- [ ] **Step 2: routes/articles.ts の 9 箇所を置換**

ファイル冒頭に `const validArticleId = uuidParam('id', NOT_FOUND_MESSAGE);` を追加し、
各ルートの先頭行 `requireUuidParam(c.req.param('id'), NOT_FOUND_MESSAGE);` を削除して
ハンドラの前段に挟む。例（`GET /:id` と `PATCH /:id`。残り 7 ルートも同形）:

```typescript
import { requireUuidParam, uuidParam } from './guards';

const validArticleId = uuidParam('id', NOT_FOUND_MESSAGE);

  .get('/:id', validArticleId, async (c) =>
    c.json(await getArticleForViewer(c.get('db'), c.req.param('id'), c.get('user'))),
  )
  .patch('/:id', validArticleId, validate('json', updateArticleSchema), async (c) =>
    c.json(await updateArticle(c.get('db'), c.req.param('id'), c.get('user'), c.req.valid('json'))),
  )
```

注意: `validate(...)` と併用するルートはミドルフェア順を `validArticleId, validate(...)` とする（UUID 不正なら body 検証前に 404）。`requireUuidParam` の import が articles.ts で不要になったら import から外す。

- [ ] **Step 3: typecheck + サーバーテスト（routes/articles.test.ts の malformed-UUID テスト含む）**

Run: `pnpm --filter @knowledge-hub/server typecheck && pnpm --filter @knowledge-hub/server test`
Expected: PASS（malformed UUID → 404 の既存テストが挙動不変を担保。web の typecheck も後で全体 verify で確認 — hc RPC 型はミドルウェア追加の影響を受けない）

- [ ] **Step 4: @types/nodemailer の要否確認**

Run: `ls node_modules/nodemailer/lib/nodemailer.d.ts 2>/dev/null || echo "no bundled types"`

nodemailer 9 が型定義を同梱している場合（`.d.ts` が存在）: `apps/server/package.json` の devDependencies から `"@types/nodemailer": "^6.4.17"` を削除し `pnpm install` 後に `pnpm --filter @knowledge-hub/server typecheck` が green であることを確認。同梱していない場合はこのステップをスキップし、その旨をタスク報告に記す。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/guards.ts apps/server/src/routes/articles.ts apps/server/package.json pnpm-lock.yaml
git commit -m "refactor(server): dedupe article :id validation via route middleware"
```

（@types 削除を行わなかった場合は package.json / lockfile を含めない。）

### ブランチ 1 完了時

- [ ] `pnpm --filter @knowledge-hub/server test && pnpm -r typecheck` green を確認
- [ ] コントローラーレビュー後、`git checkout main && git merge --no-ff refactor/server-consolidation -m "Merge refactor/server-consolidation: dedupe card columns, mention helper, :id guard"`

---

## ブランチ 2: `fix/server-minors`（Task 4〜9、挙動修正・契約変更）

開始時に `git checkout main && git checkout -b fix/server-minors`（ブランチ 1 マージ後の main から）。

### Task 4: リビジョン一覧・snapshot の id タイブレーク

**Files:**
- Modify: `apps/server/src/services/article-service.ts`（`snapshot` 内 orderBy と `listRevisions` 内 orderBy の 2 箇所）
- Test: `apps/server/src/services/article-service.test.ts`

**Interfaces:** 外部シグネチャ不変。

- [ ] **Step 1: 失敗するテストを書く**

article-service.test.ts の既存 describe 群に追加（既存のテスト用 db セットアップ・記事作成ヘルパーをそのまま使う）:

```typescript
it('listRevisions は同一 savedAt のリビジョンを id 降順で安定して返す', async () => {
  const article = await createArticle(db, author.id, {
    title: 'rev-tie', bodyMd: 'v1', categoryId: null, heroImageUploadId: null, tags: [],
  });
  // 同一タイムスタンプのリビジョンを直接 insert（snapshot の間引きを迂回）
  const savedAt = new Date('2026-01-01T00:00:00.000Z');
  await db.insert(articleRevisions).values([
    { articleId: article.id, title: 't1', bodyMd: 'b1', savedAt },
    { articleId: article.id, title: 't2', bodyMd: 'b2', savedAt },
    { articleId: article.id, title: 't3', bodyMd: 'b3', savedAt },
  ]);
  // editor には既存テストが listRevisions / updateArticle に渡している author の
  // SessionUser fixture 変数をそのまま使う（新規のヘルパーは作らない）
  const first = await listRevisions(db, article.id, editor);
  const second = await listRevisions(db, article.id, editor);
  expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  const tied = first.filter((r) => r.savedAt.getTime() === savedAt.getTime());
  expect(tied.map((r) => r.id)).toEqual([...tied.map((r) => r.id)].sort().reverse());
});
```

（`toSessionUserFixture` は疑似コード — 既存テストが listRevisions を呼ぶ際の SessionUser fixture をそのまま流用する。）

- [ ] **Step 2: テストが FAIL（または不安定）であることを確認**

Run: `pnpm --filter @knowledge-hub/server test -- article-service`
Expected: 新テストが FAIL（id 順 assert が満たされない）。orderBy が非決定的なため flaky に PASS する可能性があるが、その場合も実装後に決定性が保証される。

- [ ] **Step 3: orderBy に id タイブレークを追加**

```typescript
// snapshot 内（~39 行）
    .orderBy(desc(articleRevisions.savedAt), desc(articleRevisions.id))
// listRevisions 内（~526 行）
    .orderBy(desc(articleRevisions.savedAt), desc(articleRevisions.id));
```

- [ ] **Step 4: テスト PASS を確認**

Run: `pnpm --filter @knowledge-hub/server test -- article-service`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/article-service.ts apps/server/src/services/article-service.test.ts
git commit -m "fix(server): make revision ordering deterministic with id tiebreaker"
```

### Task 5: updateArticle の存在チェックをトランザクション内へ（TOCTOU 解消）

**Files:**
- Modify: `apps/server/src/services/article-service.ts`（`assertCategoryExists` / `assertUploadExists` のシグネチャ、`updateArticle` 冒頭）

**Interfaces:**
- `assertCategoryExists` / `assertUploadExists` の第 1 引数を `Pick<Db, 'query'>` に緩める（`RevisionStore` と同じ手法。tx を渡せるように）。`createArticle` は現状の tx なし呼び出しのまま（作成時の TOCTOU は「作成された記事が invalid category を指す」ではなく FK 違反で失敗するだけで実害が薄く、spec スコープ外）。

- [ ] **Step 1: ヘルパーのシグネチャを緩める**

```typescript
// updateArticle の SELECT ... FOR UPDATE トランザクション内から tx を渡せるように、
// Db 全体ではなく実際に使うメソッドだけを要求する（RevisionStore と同じ手法）。
type ExistenceStore = Pick<Db, 'query'>;

async function assertCategoryExists(db: ExistenceStore, categoryId: string): Promise<void> { /* 本体不変 */ }
async function assertUploadExists(db: ExistenceStore, uploadId: string): Promise<void> { /* 本体不変 */ }
```

- [ ] **Step 2: updateArticle の Promise.all チェックを tx 内へ移動**

updateArticle 冒頭（tx 外）の

```typescript
  await Promise.all([
    input.categoryId ? assertCategoryExists(db, input.categoryId) : Promise.resolve(),
    input.heroImageUploadId ? assertUploadExists(db, input.heroImageUploadId) : Promise.resolve(),
  ]);
```

を削除し、`db.transaction(async (tx) => {` 内の FOR UPDATE 直後（`if (!current)` チェックの後）に移す:

```typescript
    // カテゴリ／アップロードの存在チェックは tx 内で行う（tx 外だと deleteCategory との
    // TOCTOU で、チェック通過後に削除されたカテゴリを指す更新が通り FK 違反 → 500 になる）。
    await Promise.all([
      input.categoryId ? assertCategoryExists(tx, input.categoryId) : Promise.resolve(),
      input.heroImageUploadId ? assertUploadExists(tx, input.heroImageUploadId) : Promise.resolve(),
    ]);
```

- [ ] **Step 3: 既存テストで挙動不変を確認**

Run: `pnpm --filter @knowledge-hub/server test -- article-service && pnpm --filter @knowledge-hub/server test -- routes/articles`
Expected: PASS（不正カテゴリ 400・楽観ロック 409 等の既存テストが引き続き green。競合そのものの決定論的テストは不可能なため、構造で保証しレビューで確認）

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/services/article-service.ts
git commit -m "fix(server): check category/upload existence inside update transaction"
```

### Task 6: listComments の返信に親あたり上限 100（防御上限）

**Files:**
- Modify: `apps/server/src/services/comment-service.ts`（`listComments` の replyRows クエリ）
- Test: `apps/server/src/services/comment-service.test.ts`

**Interfaces:** 外部シグネチャ・レスポンス形状不変（通常件数では結果も不変）。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
it('replies は親コメント 1 件につき最大 100 件に制限される', async () => {
  // 既存ヘルパーで published 記事とトップレベルコメントを作成
  const parent = await createComment(db, article.id, author, { bodyMd: 'parent' });
  await db.insert(comments).values(
    Array.from({ length: 101 }, (_, i) => ({
      articleId: article.id,
      authorId: author.id,
      parentId: parent.id,
      bodyMd: `reply-${i}`,
    })),
  );
  const page = await listComments(db, article.id, { limit: 20 });
  const node = page.items.find((n) => n.id === parent.id)!;
  expect(node.replies).toHaveLength(100);
});
```

（`article` / `author` は既存テストの published 記事・SessionUser fixture を流用。）

- [ ] **Step 2: テスト FAIL を確認**

Run: `pnpm --filter @knowledge-hub/server test -- comment-service`
Expected: FAIL（replies が 101 件返る）

- [ ] **Step 3: 返信クエリを window 関数のサブクエリに置換**

```typescript
// 返信は 1 階層のみで実運用では少数だが、防御上限として親ごとに最大 100 件に制限する
// （超過分は切り捨て。無制限だと 1 親に大量返信を付けられた場合にレスポンスが際限なく肥大する）。
const REPLIES_PER_PARENT_LIMIT = 100;
```

`listComments` 内の replyRows 取得を以下に置換:

```typescript
  const ranked = db
    .select({
      ...COMMENT_COLUMNS,
      rn: sql<number>`row_number() over (
        partition by ${comments.parentId}
        order by ${comments.createdAt} asc, ${comments.id} asc
      )`.as('rn'),
    })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(inArray(comments.parentId, topIds))
    .as('ranked');
  const replyRows = topIds.length
    ? await db
        .select()
        .from(ranked)
        .where(sql`${ranked.rn} <= ${REPLIES_PER_PARENT_LIMIT}`)
        .orderBy(asc(ranked.createdAt), asc(ranked.id))
    : [];
```

注意: サブクエリ select の結果に `rn` が含まれるが、後続の `toNode(r)` は必要フィールドだけ読むため無害。型エラーが出る場合は map で `({ rn: _rn, ...rest }) => rest` を挟む。

- [ ] **Step 4: テスト PASS + 既存テスト green を確認**

Run: `pnpm --filter @knowledge-hub/server test -- comment-service`
Expected: 全 PASS（少数返信の既存テストは順序・件数とも不変）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/comment-service.ts apps/server/src/services/comment-service.test.ts
git commit -m "fix(server): cap comment replies at 100 per parent"
```

### Task 7: comment create/update レスポンスを CommentItem に統一

**Files:**
- Modify: `packages/shared/src/types.ts`（wire 型追加）
- Modify: `apps/server/src/services/comment-service.ts`（`CommentItem` 型 + 再 SELECT）
- Modify: `apps/web/src/components/CommentSection.tsx`（ローカル/casted 型を shared に）
- Test: `apps/server/src/services/comment-service.test.ts`

**Interfaces:**
- Produces（server）: `export type CommentItem = Omit<CommentNode, 'replies'>;`（comment-service）。`createComment` / `updateComment` の戻りが `CommentRecord` → `CommentItem` に変わる（authorName を含み、bodyMd の可視性規則が list と同一になる）。
- Produces（shared）: `CommentItemData` / `CommentNodeData`（wire 形状、日付は string。`ArticleCardData` と同じ流儀）。
- 注意: ルート `routes/comments.ts` / `routes/articles.ts`（POST /:id/comments）はサービス戻り値をそのまま `c.json()` しているため変更不要。hc 推論で web に伝播する。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
it('createComment / updateComment は authorName を含む CommentItem 形で返す', async () => {
  const created = await createComment(db, article.id, author, { bodyMd: 'hello' });
  expect(created.authorName).toBe(author.displayName);
  expect(created.isDeleted).toBe(false);
  expect(created).not.toHaveProperty('replies');
  expect(created).not.toHaveProperty('deletedAt'); // raw row でなく整形済み

  const updated = await updateComment(db, created.id, author, { bodyMd: 'edited' });
  expect(updated.authorName).toBe(author.displayName);
  expect(updated.bodyMd).toBe('edited');
});
```

- [ ] **Step 2: テスト FAIL を確認**

Run: `pnpm --filter @knowledge-hub/server test -- comment-service`
Expected: FAIL（現状は raw `CommentRecord` を返すため authorName が undefined）

- [ ] **Step 3: comment-service を実装**

```typescript
export type CommentItem = Omit<CommentNode, 'replies'>;

// toNode を toItem + replies 付与に再構成（列挙の重複を避ける）
function toItem(row: {
  id: string; articleId: string; authorId: string; authorName: string;
  parentId: string | null; bodyMd: string; deletedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}): CommentItem {
  const isDeleted = row.deletedAt !== null;
  return {
    id: row.id,
    articleId: row.articleId,
    authorId: row.authorId,
    authorName: row.authorName,
    parentId: row.parentId,
    bodyMd: isDeleted ? null : row.bodyMd,
    isDeleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
function toNode(row: Parameters<typeof toItem>[0]): CommentNode {
  return { ...toItem(row), replies: [] };
}

/** mutation 後に list と同じ形（author JOIN 済み・可視性規則適用）で 1 件返す */
async function loadItem(db: Db, id: string): Promise<CommentItem> {
  const [row] = await db
    .select(COMMENT_COLUMNS)
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.id, id));
  return toItem(row);
}
```

`createComment` の戻り型を `Promise<CommentItem>` にし、末尾 `return row;` を `return loadItem(db, row.id);` に変更（`runNotify` への `row` 渡しはそのまま）。`updateComment` も同様に戻り型 `Promise<CommentItem>`、末尾を `return loadItem(db, row.id);` に。

- [ ] **Step 4: shared に wire 型を追加**

```typescript
// packages/shared/src/types.ts（ArticleCardData の下に追加）
/** コメント 1 件の wire 形状（日付は ISO 文字列）。list のツリーは CommentNodeData。 */
export type CommentItemData = {
  id: string;
  articleId: string;
  authorId: string;
  authorName: string;
  parentId: string | null;
  bodyMd: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};
export type CommentNodeData = CommentItemData & { replies: CommentItemData[] };
```

- [ ] **Step 5: web の CommentSection を shared 型に**

`CommentSection.tsx` の `as CommentNode[]` キャスト（~226 行、ローカル or import されている `CommentNode` 型）を `CommentNodeData` に置換する:

```typescript
import type { CommentNodeData } from '@knowledge-hub/shared';
// ...
const items = (query.data?.pages ?? []).flatMap((p) => p.items) as CommentNodeData[];
```

ローカルに `CommentNode` 型定義があれば削除して shared に一本化。`CommentItem` コンポーネントの props 型も `CommentNodeData` / `CommentItemData` に合わせる。可能なら hc 推論と一致することを確認して `as` 自体を外す（union の絞り込みで必要なら残してよいが、shared 型を指すこと）。

- [ ] **Step 6: 全体 typecheck + テスト**

Run: `pnpm -r typecheck && pnpm --filter @knowledge-hub/server test -- comment-service && pnpm --filter @knowledge-hub/web test`
Expected: PASS（typecheck が mutation レスポンスの全消費箇所の追従漏れを検出する）

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types.ts apps/server/src/services/comment-service.ts apps/server/src/services/comment-service.test.ts apps/web/src/components/CommentSection.tsx
git commit -m "fix(server): return author-joined CommentItem from comment mutations"
```

### Task 8: avatarUrl の所有チェック

**Files:**
- Modify: `apps/server/src/services/user-service.ts`（`updateProfile`）
- Test: `apps/server/src/routes/users.test.ts`

**Interfaces:** `updateProfile` シグネチャ不変。avatarUrl が「実在し、かつ本人がアップロードした upload」を指さない場合 `AppError('VALIDATION', ..., 400)`。

- [ ] **Step 1: 失敗するテストを書く**

routes/users.test.ts に追加（既存の認証済みクライアント fixture を流用）:

```typescript
it('PATCH /me は他人のアップロード UUID を avatarUrl に指定すると 400', async () => {
  // 別ユーザーのアップロード行を直接 insert
  const [upload] = await db.insert(uploads).values({
    uploaderId: otherUser.id, storageKey: 'k', mimeType: 'image/png', size: 1,
  }).returning();
  const res = await client.api.users.me.$patch({
    json: { displayName: 'x', bio: '', avatarUrl: `/api/uploads/${upload.id}` },
  });
  expect(res.status).toBe(400);
});

it('PATCH /me は本人のアップロード UUID の avatarUrl を受理する', async () => {
  const [upload] = await db.insert(uploads).values({
    uploaderId: me.id, storageKey: 'k2', mimeType: 'image/png', size: 1,
  }).returning();
  const res = await client.api.users.me.$patch({
    json: { displayName: 'x', bio: '', avatarUrl: `/api/uploads/${upload.id}` },
  });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: テスト FAIL を確認**

Run: `pnpm --filter @knowledge-hub/server test -- routes/users`
Expected: 1 件目が FAIL（現状は無検証で 200）

- [ ] **Step 3: updateProfile に所有チェックを実装**

```typescript
// apps/server/src/services/user-service.ts
import { uploads, users } from '../db/schema';

const AVATAR_URL_PREFIX = '/api/uploads/';

export async function updateProfile(
  db: Db,
  userId: string,
  input: { displayName: string; bio: string; avatarUrl?: string | null },
): Promise<SessionUser> {
  // updateProfileSchema が形式（/api/uploads/<uuid> アンカー付き）を保証済み。
  // ここでは「実在し、本人がアップロードしたものか」を検証する（他人の upload UUID を
  // アバターに据えると、upload GET の可視性がアバター経由で緩む・出所不明の画像を
  // 自分のプロフィールに紐づけられる、を防ぐ）。
  if (input.avatarUrl) {
    const uploadId = input.avatarUrl.slice(AVATAR_URL_PREFIX.length);
    const owned = await db.query.uploads.findFirst({
      where: and(eq(uploads.id, uploadId), eq(uploads.uploaderId, userId)),
      columns: { id: true },
    });
    if (!owned) throw new AppError('VALIDATION', 'アバター画像が不正です', 400);
  }
  // 以下、既存の update はそのまま
```

- [ ] **Step 4: テスト PASS + 既存テスト green（avatarUrl: null 削除経路が壊れていないこと）**

Run: `pnpm --filter @knowledge-hub/server test -- routes/users && pnpm --filter @knowledge-hub/server test -- user-service`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/user-service.ts apps/server/src/routes/users.test.ts
git commit -m "fix(server): require avatar upload to be owned by the user"
```

### Task 9: X-Request-Id レスポンスヘッダ

**Files:**
- Modify: `apps/server/src/middleware/request-logger.ts`
- Test: `apps/server/src/middleware/request-logger.test.ts`（存在しない場合は新規作成。既存の middleware テストの流儀に合わせる）

- [ ] **Step 1: 失敗するテストを書く**

```typescript
it('レスポンスに X-Request-Id ヘッダ（UUID）を付与する', async () => {
  const app = new Hono().use(requestLogger).get('/ping', (c) => c.text('ok'));
  const res = await app.request('/ping');
  const id = res.headers.get('X-Request-Id');
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
```

- [ ] **Step 2: テスト FAIL を確認**

Run: `pnpm --filter @knowledge-hub/server test -- request-logger`
Expected: FAIL（ヘッダなし）

- [ ] **Step 3: 実装**

`await next();` の直後に 1 行追加:

```typescript
  await next();
  // ログの requestId と突き合わせられるようにレスポンスにも返す（障害調査用）
  c.res.headers.set('X-Request-Id', requestId);
```

- [ ] **Step 4: テスト PASS を確認**

Run: `pnpm --filter @knowledge-hub/server test -- request-logger`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/middleware/request-logger.ts apps/server/src/middleware/request-logger.test.ts
git commit -m "feat(server): expose request id via X-Request-Id response header"
```

### ブランチ 2 完了時

- [ ] `pnpm --filter @knowledge-hub/server test && pnpm -r typecheck && pnpm --filter @knowledge-hub/web test` green を確認
- [ ] コントローラーレビュー後、`git checkout main && git merge --no-ff fix/server-minors -m "Merge fix/server-minors: revision tiebreak, tx existence checks, reply cap, comment item shape, avatar ownership, request id"`

---

## ブランチ 3: `refactor/web-cleanup`（Task 10〜12）

開始時に `git checkout main && git checkout -b refactor/web-cleanup`（ブランチ 2 マージ後の main から）。

### Task 10: query-key ファクトリ

**Files:**
- Create: `apps/web/src/api/keys.ts`
- Modify（全キー利用箇所）: `auth/useMe.ts` / `api/categories.ts` / `api/articles.ts` / `api/notifications.ts` / `api/engagement.ts` / `components/NotificationBell.tsx` / `components/MentionTextarea.tsx` / `components/CommentSection.tsx` / `pages/HomePage.tsx` / `pages/MyArticlesPage.tsx` / `pages/BookmarksPage.tsx` / `pages/CategoryPage.tsx` / `pages/TagPage.tsx` / `pages/ProfilePage.tsx` / `pages/SearchPage.tsx` / `pages/NotificationsPage.tsx` / `pages/LoginPage.tsx` / `pages/SettingsPage.tsx` / `pages/EditorPage.tsx` / `pages/AdminUsersPage.tsx` / `pages/AdminCategoriesPage.tsx` / `pages/ArticleDetailPage.tsx`

**Interfaces:**
- Produces: `export const keys`（下記）。**各エントリは既存リテラルの写し**であり、配列の実体は 1 要素も変えない（キャッシュ互換・invalidate プレフィックス一致の維持が正しさの条件）。
- `api/engagement.ts` の既存 `engagementKey(articleId)` は `keys.engagement` の別名として維持（`return keys.engagement(articleId);`）。利用側（BookmarkButton/ReactionBar）は無変更でよい。

- [ ] **Step 1: keys.ts を作成**

```typescript
// apps/web/src/api/keys.ts
/**
 * TanStack Query の queryKey を一元管理するファクトリ。
 * クエリ側と invalidate 側でリテラルが乖離すると「無音でキャッシュが更新されない」
 * バグになるため、キーは必ずここを経由する。
 * 注意: 各エントリの配列実体は従来のリテラルと同一に保つこと（キャッシュ互換）。
 * `keys.notifications.all` は recent / unreadCount / list の prefix であり、
 * invalidateQueries に渡すと 3 つまとめて無効化される（従来挙動）。
 */
export const keys = {
  me: ['me'] as const,
  authMethods: ['auth-methods'] as const,
  feed: ['feed'] as const,
  pickup: ['pickup'] as const,
  mine: (tab: 'draft' | 'published' | 'trash') => ['mine', tab] as const,
  bookmarks: ['bookmarks'] as const,
  category: (id: string) => ['category', id] as const,
  tag: (name: string) => ['tag', name] as const,
  userArticles: (userId: string) => ['user-articles', userId] as const,
  article: (id: string) => ['article', id] as const,
  comments: (articleId: string) => ['comments', articleId] as const,
  engagement: (articleId: string) => ['engagement', articleId] as const,
  categories: ['categories'] as const,
  user: (id: string) => ['user', id] as const,
  adminUsers: ['admin-users'] as const,
  mentionCandidates: ['mention-candidates'] as const,
  search: (q: string, categoryId: string, tagName: string, authorId: string) =>
    ['search', q, categoryId, tagName, authorId] as const,
  notifications: {
    all: ['notifications'] as const,
    recent: ['notifications', 'recent'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
    list: ['notifications', 'list'] as const,
  },
} as const;
```

（`search` の引数型は SearchPage の現状の変数型に合わせる — 現在 `['search', q, categoryId, tag, authorId]` で各値が `string` なら上記のまま、`string | null` 等なら合わせて調整し、**配列に入る値は従来と同一**にする。）

- [ ] **Step 2: 全利用箇所を keys 経由に置換**

対象（前掲 grep 済みの全箇所）:

| ファイル | 置換 |
|---|---|
| `auth/useMe.ts:6` | `keys.me` |
| `pages/LoginPage.tsx:31` | `keys.authMethods` / `:53` `keys.me` |
| `pages/SettingsPage.tsx:49` | `keys.me` |
| `pages/HomePage.tsx:12` | `keys.pickup` / `:19` `keys.feed` |
| `pages/EditorPage.tsx:218` | `keys.feed` |
| `pages/MyArticlesPage.tsx:16` | `keys.mine(tab)` |
| `pages/BookmarksPage.tsx:9` | `keys.bookmarks` |
| `pages/CategoryPage.tsx:10` | `keys.category(id)` |
| `pages/TagPage.tsx:10` | `keys.tag(name)` |
| `pages/ProfilePage.tsx:14` | `keys.user(id)` / `:22` `keys.userArticles(id)` |
| `pages/SearchPage.tsx:59-60` | `keys.search(q, categoryId, tag, authorId)` |
| `api/articles.ts:6` | `keys.article(id)` |
| `pages/ArticleDetailPage.tsx:59` | `keys.article(id)` |
| `components/CommentSection.tsx:104,105,213,240,241` | `keys.comments(articleId)` / `keys.engagement(articleId)` |
| `api/engagement.ts` | `engagementKey` の実装を `keys.engagement` 委譲に |
| `api/categories.ts:16` | `keys.categories` |
| `pages/AdminCategoriesPage.tsx:20` | `keys.categories` |
| `pages/AdminUsersPage.tsx:19,35` | `keys.adminUsers` |
| `components/MentionTextarea.tsx:36` | `keys.mentionCandidates` |
| `components/NotificationBell.tsx:17` | `keys.notifications.recent` |
| `api/notifications.ts:8` | `keys.notifications.unreadCount` / `:33` `keys.notifications.all` |
| `pages/NotificationsPage.tsx:17` | `keys.notifications.list` / `:39` `keys.notifications.all` |

- [ ] **Step 3: リテラル残存ゼロを機械確認**

Run: `grep -rn "queryKey: \['" apps/web/src --include='*.ts' --include='*.tsx' | grep -v test; grep -rn "useCursorList(\['" apps/web/src --include='*.tsx' | grep -v test`
Expected: 出力なし（テストファイルのリテラルは許容）

- [ ] **Step 4: web テスト + typecheck**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 全 PASS（キー実体が不変なら既存テストは無修正で通る）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "refactor(web): centralize query keys in a key factory"
```

### Task 11: useCanManage hook（admin-or-owner）

**Files:**
- Create: `apps/web/src/auth/useCanManage.ts`
- Create: `apps/web/src/auth/useCanManage.test.tsx`
- Modify: `apps/web/src/components/CommentSection.tsx:100`（`canDelete`）
- Modify: `apps/web/src/pages/ArticleDetailPage.tsx:34`（`canManage`）

**Interfaces:**
- Produces: `export function useCanManage(authorId: string | undefined): boolean` — me 未解決・authorId 未定義なら false。**「本人 or 管理者」ルールの Web 側の唯一の定義**（サーバー側の真の認可は `permissions.ts` の `can()`）。
- 注意: `CommentSection` の `canEdit`（本人のみ）は対象外でそのまま。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// apps/web/src/auth/useCanManage.test.tsx
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCanManage } from './useCanManage';

const me = { current: undefined as { id: string; role: string } | undefined };
vi.mock('./useMe', () => ({ useMe: () => ({ data: me.current }) }));

describe('useCanManage', () => {
  it('本人なら true', () => {
    me.current = { id: 'u1', role: 'member' };
    expect(renderHook(() => useCanManage('u1')).result.current).toBe(true);
  });
  it('admin なら他人の対象でも true', () => {
    me.current = { id: 'admin1', role: 'admin' };
    expect(renderHook(() => useCanManage('u1')).result.current).toBe(true);
  });
  it('他人の member は false', () => {
    me.current = { id: 'u2', role: 'member' };
    expect(renderHook(() => useCanManage('u1')).result.current).toBe(false);
  });
  it('me 未解決 / authorId 未定義は false', () => {
    me.current = undefined;
    expect(renderHook(() => useCanManage('u1')).result.current).toBe(false);
    me.current = { id: 'u1', role: 'member' };
    expect(renderHook(() => useCanManage(undefined)).result.current).toBe(false);
  });
});
```

- [ ] **Step 2: テスト FAIL（モジュール不在）を確認**

Run: `pnpm --filter @knowledge-hub/web test -- useCanManage`
Expected: FAIL（Cannot find module './useCanManage'）

- [ ] **Step 3: hook を実装**

```typescript
// apps/web/src/auth/useCanManage.ts
import { useMe } from './useMe';

/**
 * 「対象の作成者本人 or 管理者」の Web 側判定（記事管理・コメント削除で共通）。
 * 真の認可境界はサーバー（permissions.ts の can()）で、これは表示制御用。
 */
export function useCanManage(authorId: string | undefined): boolean {
  const { data: me } = useMe();
  return Boolean(me && authorId && (me.role === 'admin' || me.id === authorId));
}
```

- [ ] **Step 4: テスト PASS を確認**

Run: `pnpm --filter @knowledge-hub/web test -- useCanManage`
Expected: PASS（4 件）

- [ ] **Step 5: 2 箇所を置換**

CommentSection（CommentItem コンポーネント内）:

```typescript
const canDelete = useCanManage(comment.authorId);
```

ArticleDetailPage: hook は早期 return（isLoading/isError）より**前**に呼ぶ必要がある。`const canManage = useCanManage(article?.authorId);` を他の hook 群と同じ位置（早期 return の前）へ移し、既存の `const canManage = Boolean(me && ...)` 行を削除。`me` が他で未使用にならないか確認（`canPin` が `me?.role` を使うので `useMe` は残る）。

- [ ] **Step 6: web テスト全件 green を確認**

Run: `pnpm --filter @knowledge-hub/web test`
Expected: PASS（CommentSection / ArticleDetailPage の既存テストが挙動不変を担保）

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/auth/useCanManage.ts apps/web/src/auth/useCanManage.test.tsx apps/web/src/components/CommentSection.tsx apps/web/src/pages/ArticleDetailPage.tsx
git commit -m "refactor(web): extract admin-or-owner check into useCanManage hook"
```

### Task 12: Web 小修正（公開パネル・キャスト・a11y・href テスト）

**Files:**
- Modify: `apps/web/src/pages/EditorPage.tsx`（`publish()` と公開パネルのボタン、~193 / ~365 行）
- Modify: `apps/web/src/pages/HomePage.tsx:16`
- Modify: `apps/web/src/components/MentionTextarea.tsx:133-152`
- Modify: `apps/web/src/pages/ArticleDetailPage.test.tsx`（href assert 追加）
- Test: `apps/web/src/pages/EditorPage.test.tsx`（失敗時パネル維持）

- [ ] **Step 1: 公開パネルの失敗時テストを書く**

EditorPage.test.tsx の既存 fixture（fetch モック）を流用し、publish API を失敗させるケースを追加:

```typescript
it('公開失敗時はパネルが開いたままエラーが表示される', async () => {
  // 既存テストの記事ロード・保存モックに加え、POST /api/articles/:id/publish を 400 で返す
  // （既存のモック流儀: fetch モックのルーティングに publish → { ok: false } を追加）
  // 1. エディタを開き、タイトル・カテゴリを設定して公開パネルを開く
  // 2. 「公開する」をクリック
  await user.click(screen.getByRole('button', { name: '公開する' }));
  // 3. パネル（dialog）が閉じていないこと + エラー文言がパネル内に見えること
  expect(screen.getByRole('dialog', { name: '公開設定' })).toBeInTheDocument();
  expect(await screen.findByText('公開に失敗しました')).toBeInTheDocument();
});
```

（セットアップ詳細は同ファイルの既存「公開」テストをコピーして publish モックのみ失敗に変える。）

- [ ] **Step 2: テスト FAIL を確認**

Run: `pnpm --filter @knowledge-hub/web test -- EditorPage`
Expected: FAIL（現状は即 `setPublishOpen(false)` で dialog が消える）

- [ ] **Step 3: publish を成功可否返しにしてパネル閉鎖を成功時のみに**

`publish()` の戻り型を `Promise<boolean>` にし、全ての失敗 return を `return false;`、成功パス末尾（`navigate` 後）を `return true;` に変更。パネルのボタンを:

```tsx
<Button
  type="button"
  disabled={!categoryId || !title.trim()}
  onClick={async () => {
    if (await publish()) setPublishOpen(false);
  }}
>
  {publishLabel}
</Button>
```

さらにパネル内（ボタンの直上）にエラー表示を追加（`error` state はページ側と共有。パネルが開いている間は背後の表示が見えないため）:

```tsx
{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
```

- [ ] **Step 4: テスト PASS を確認**

Run: `pnpm --filter @knowledge-hub/web test -- EditorPage`
Expected: PASS（成功時にパネルが閉じてナビゲートする既存テストも green のこと）

- [ ] **Step 5: HomePage のキャスト除去**

`pages/HomePage.tsx:16` の `return (await res.json()) as ArticleItem[];` を `return res.json();` に変更。

Run: `pnpm --filter @knowledge-hub/web typecheck`
Expected: PASS（pickup エンドポイントの hc 推論が `ArticleItem`（wire 形状）と一致するため。万一ここで型不一致が出る場合は wire 形状の実差分なので、キャストを戻さず `ArticleItem` 側の定義とサーバーレスポンスを突き合わせて原因を報告すること）

- [ ] **Step 6: MentionTextarea の nested-interactive を解消**

`role="option"` の `li` 内の `button` は入れ子のインタラクティブ要素（フォーカスも tabIndex=-1 で殺している）で a11y 上の異臭。button を外し、スタイルとテキストを li 自体へ:

```tsx
{matches.map((c, i) => (
  <li
    key={c.id}
    role="option"
    aria-selected={i === active}
    className={`w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm ${i === active ? 'bg-accent text-accent-foreground' : ''}`}
    onMouseDown={(e) => {
      e.preventDefault();
      insertMention(c);
    }}
  >
    {c.displayName}
  </li>
))}
```

（キーボード操作は従来どおり textarea 側の onKeyDown が担う。listbox はコンボボックス様の提示専用。）

Run: `pnpm --filter @knowledge-hub/web test -- MentionTextarea`
Expected: PASS（既存テストが `role=option` とクリック挿入を見ているなら無修正 green。button 前提のセレクタがあれば option 参照に更新 — assertion の弱体化はしない）

- [ ] **Step 7: 記事詳細テストに著者リンク href 検証を追加**

`ArticleDetailPage.test.tsx` の記事表示テストに追加（fixture の authorId / authorName はファイル内の既存値を使う）:

```typescript
expect(screen.getByRole('link', { name: fixtureAuthorName })).toHaveAttribute(
  'href',
  `/users/${fixtureAuthorId}`,
);
```

Run: `pnpm --filter @knowledge-hub/web test -- ArticleDetailPage`
Expected: PASS（3a のブラウザ検証で否定済みのセレクタ artifact を単体レベルで固定化）

- [ ] **Step 8: コントラスト検査（MentionTextarea のクラス変更があるため）**

Run: `pnpm --filter @knowledge-hub/web check:contrast`
Expected: 全ペア ok

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/EditorPage.tsx apps/web/src/pages/EditorPage.test.tsx apps/web/src/pages/HomePage.tsx apps/web/src/components/MentionTextarea.tsx apps/web/src/pages/ArticleDetailPage.test.tsx
git commit -m "fix(web): keep publish panel open on failure and clean up minor UI issues"
```

### ブランチ 3 完了時

- [ ] `pnpm --filter @knowledge-hub/web test && pnpm -r typecheck` green を確認
- [ ] コントローラーレビュー後、`git checkout main && git merge --no-ff refactor/web-cleanup -m "Merge refactor/web-cleanup: query-key factory, useCanManage, publish panel fix"`

---

## 最終検証（全ブランチマージ後）

- [ ] `pnpm run verify` → exit 0（typecheck + 全テスト + contrast + web build + audit）
- [ ] E2E: `pnpm run e2e:up && pnpm run e2e && pnpm run e2e:down` → 全 spec PASS（クリーン state）
- [ ] `docs/api.md` の追従確認: comment mutation のレスポンス形状変更（Task 7）が API 一覧の概要に影響する場合は更新（メソッド・パス・認可は不変なので概要文のみ）。画面一覧（docs/screens.md）はルート・権限変更なしのため対象外。
- [ ] 台帳 `.superpowers/sdd/progress.md` に本バッチの節を追記（解消した保留項目と、スコープ外として残す項目の一覧）
