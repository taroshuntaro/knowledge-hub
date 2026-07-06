# Phase 3b: コメント・リアクション・ブックマーク 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公開記事に対するコメント（フラット + 1 階層返信、Markdown、論理削除）・リアクション（絵文字プリセットのトグル、楽観的更新）・ブックマーク（トグル + 一覧ページ）を実装する。

**Architecture:** 3 つの新テーブル（`comments` / `reactions` / `bookmarks`）を Drizzle で追加し、それぞれサービス層（`CommentService` / `ReactionService` / `BookmarkService`）に集約する。コメントとリアクションの**作成処理は将来の通知生成（Phase 3c）の唯一の差し込み点**とし、このフェーズでは `notifications` テーブルには一切書き込まない（設計 §3「通知生成はサービス層 1 箇所に集約」）。コメント本文は既存のサニタイズ済み Markdown コンポーネントで描画し、新たな XSS 面を作らない。リアクション/ブックマークの状態と件数は記事詳細用のまとめ取得エンドポイント（engagement）で 1 往復で返す。

**Tech Stack:** 既存スタック（Hono / Drizzle / PostgreSQL / React 19 / TanStack Query / shadcn + Tailwind v4）。新規ライブラリなし。

**Spec:** `docs/superpowers/specs/2026-07-04-knowledge-hub-design.md` §4（データモデル: comments/reactions/bookmarks）・§5（権限: 自分のコメント編集削除 / admin は任意削除）・§7（画面: 記事詳細・ブックマーク一覧）・§8（コメント・リアクション・ブックマーク）・§9（楽観的更新はリアクションのみ）。

## Global Constraints

- **対象は公開・未削除記事のみ**: コメント・リアクション・ブックマークの作成/取得は `status = 'published'` かつ `deleted_at IS NULL` の記事に対してのみ許可する。それ以外（下書き・ゴミ箱・不在）は `NOT_FOUND`（404）を返す。下書きの内容が第三者に露出する経路を作らない。
- **返信は 1 階層厳格**: `parent_id` は**トップレベルコメント**（`parent_id IS NULL`）かつ**同一記事**のコメントのみを指せる。返信への返信（`parent` が既に子）は `VALIDATION`（400）で拒否する。
- **コメントは論理削除**: 削除は `deleted_at` を立てるのみ。削除済みコメントはツリー構造を保つため一覧に残すが、**`body_md` はクライアントに一切返さない**（`isDeleted: true` フラグ + 空本文で返し、UI は「削除されました」を表示）。返信も同じ。
- **コメント本文は既存のサニタイズ Markdown パイプラインで描画**（`apps/web/src/lib/markdown.tsx` の `Markdown` コンポーネントを再利用）。コメントに画像アップロード UI は付けない。メンション（`@`）は生テキストのまま保存し、このフェーズでは linkify も通知もしない（Phase 3c）。
- **リアクション絵文字はサーバー側プリセットのみ**: 許可する絵文字は共有定数 `REACTION_EMOJIS`（`['👍', '❤️', '🎉', '🙌', '👀']`）に限定。プリセット外の絵文字は `VALIDATION`（400）で拒否する。
- **権限**: コメントの編集・削除は既存の `can()`（Phase 2a のリソース対応）を使う。作成者は自分のコメントを編集・削除でき、admin は任意のコメントを削除できる（編集は作成者のみ）。リアクション・ブックマークは常に本人の分のみ（他人の分を操作する API を作らない）。
- **通知は 3b では生成しない**: `notifications` テーブルへの書き込み・メンション解析・ベル UI はすべて Phase 3c。comment/reaction サービスの作成関数が 3c の差し込み点になるよう、副作用のない純粋な作成処理として実装する。
- **楽観的更新はリアクションのみ**（設計 §9）。ブックマーク・コメントはサーバー確定を待つ。
- API は統一エラー形式 `{ code, message, details? }`。既存テスト（web 68 / server 136）は無修正で green を維持する。
- 色はデザイントークンのみ（生の色コード直書き禁止。例外: `components/ui/` 生成物）。
- 各タスク完了時に該当パッケージの `test` と `typecheck` が green（server を触るタスクは Docker 起動前提で `@knowledge-hub/server test`、web を触るタスクは `@knowledge-hub/web test`。全体 `pnpm typecheck` も緑を保つ）。

## 非スコープ（このフェーズでやらない）

- 通知（アプリ内通知・ベル・未読バッジ・既読管理）とメンション解析・リンク化 → Phase 3c
- コメントのリッチエディタ（Tiptap 切替）。コメントは簡易テキストエリアのみ（設計 §8）
- コメントのリビジョン履歴・編集履歴表示
- リアクションの絵文字ピッカー（自由絵文字選択）。プリセットのみ
- コメント/リアクション数の記事一覧カードへの表示（記事詳細のみ）
- 2 階層を超える返信スレッド

## File Structure

```
apps/server/
  src/db/schema.ts                          # 変更: comments / reactions / bookmarks テーブル + リレーション追加
  drizzle/0003_comments_reactions_bookmarks.sql  # 新規: drizzle-kit generate で生成
  src/services/permissions.ts               # 変更: Action に comment:edit / comment:delete を追加
  src/services/comment-service.ts           # 新規: CommentService
  src/services/comment-service.test.ts      # 新規
  src/services/engagement-service.ts        # 新規: ReactionService + BookmarkService + engagement まとめ取得
  src/services/engagement-service.test.ts   # 新規
  src/routes/comments.ts                    # 新規: 記事コメント + コメント個別操作
  src/routes/comments.test.ts               # 新規
  src/routes/engagement.ts                  # 新規: reactions / bookmarks / engagement / me/bookmarks
  src/routes/engagement.test.ts             # 新規
  src/app.ts                                # 変更: ルート配線（deps 追加は不要 — サービスは関数 export 想定、既存 article/user routes と同じ流儀に合わせる）
packages/shared/src/
  constants.ts（無ければ新規）              # 変更/新規: REACTION_EMOJIS
  schemas/comment.ts                        # 新規: createCommentSchema / updateCommentSchema / reactionSchema
  schemas/comment.test.ts                   # 新規
  index.ts                                  # 変更: 追加スキーマ・定数の re-export（barrel が wildcard なら自動）
apps/web/src/
  api/client.ts                             # 変更なし想定（hc<AppType> は型自動追従。確認のみ）
  components/CommentSection.tsx             # 新規: コメント一覧 + 投稿/返信/編集/削除
  components/CommentSection.test.tsx        # 新規
  components/ReactionBar.tsx                # 新規: プリセット絵文字トグル（楽観的更新）
  components/ReactionBar.test.tsx           # 新規
  components/BookmarkButton.tsx             # 新規: ブックマークトグル
  pages/ArticleDetailPage.tsx              # 変更: engagement 取得 + ReactionBar + BookmarkButton + CommentSection 埋め込み
  pages/BookmarksPage.tsx                  # 新規: /me/bookmarks
  pages/BookmarksPage.test.tsx             # 新規
  components/Layout.tsx                     # 変更: ヘッダー/ナビに「ブックマーク」リンク
  App.tsx                                   # 変更: /me/bookmarks ルート
```

## モデル・スキル指定

- Task 3（CommentService）と Task 4（Engagement）は 1 階層返信の検証・カーソル・まとめ取得の判断を要するため標準以上のモデルを推奨。他は既存パターンの転写が中心。
- UI は 2b-1 のデザインシステム（トークン + 確立済みパターン）を踏襲。新規デザイン創作は不要。

---

### Task 1: スキーマ + マイグレーション（comments / reactions / bookmarks）

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/0003_comments_reactions_bookmarks.sql`（`drizzle-kit generate` で生成）

**Interfaces:**
- Produces: `comments` / `reactions` / `bookmarks` テーブル定義と型（Task 3/4 が使用）。

- [ ] **Step 1: schema.ts に 3 テーブルを追加**

既存の `articles` / `users` テーブル定義の流儀（`pgTable`、`uuid('id').primaryKey().defaultRandom()`、`timestamp` の使い方、FK は `.references(() => ...)`、`relations`）を読んで**同じ形式**で追加する。列は設計 §4 のとおり:

```ts
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull().references(() => users.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('comments_article_created_idx').on(t.articleId, t.createdAt),
    index('comments_parent_idx').on(t.parentId),
  ],
);

export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reactions_user_article_emoji_uniq').on(t.userId, t.articleId, t.emoji),
    index('reactions_article_idx').on(t.articleId),
  ],
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    articleId: uuid('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bookmarks_user_article_uniq').on(t.userId, t.articleId),
    index('bookmarks_user_created_idx').on(t.userId, t.createdAt),
  ],
);
```

`AnyPgColumn` / `index` / `uniqueIndex` を `drizzle-orm/pg-core` から import（既存 import 行に追加）。自己参照 FK（`parentId` → `comments.id`）は `(): AnyPgColumn =>` の遅延参照が必要。`relations()` を既存の articles/users と同じ流儀で定義（comments.article / comments.author / comments.parent / comments.replies）。既存の articles/users relations に `comments`/`reactions`/`bookmarks` の逆リレーションを足すのは、Task 3/4 のクエリで relational query を使う場合のみ。使わない（明示 join のみ）なら省略可。

- [ ] **Step 2: マイグレーション生成**

```bash
pnpm --filter @knowledge-hub/server exec drizzle-kit generate --name=comments_reactions_bookmarks
```

生成された `drizzle/0003_comments_reactions_bookmarks.sql` と `meta/` を確認（journal に idx:3 が追加されること）。手で SQL を書き換えない（スキーマから生成させる）。

- [ ] **Step 3: alpine テスト DB で migration が通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test`
Expected: 既存 136 テスト green（global-setup が新 migration を postgres:16-alpine に適用する。ここで落ちれば migration の構文エラー）。

- [ ] **Step 4: 実 DB にも適用して確認**

Run: `pnpm --filter @knowledge-hub/server db:migrate` then
`docker compose exec db psql -U khub -d khub -c "\dt comments reactions bookmarks"`
Expected: 3 テーブルが表示される。

- [ ] **Step 5: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/server typecheck`

```bash
git add apps/server
git commit -m "feat(server): add comments, reactions, bookmarks tables"
```

---

### Task 2: shared スキーマ + REACTION_EMOJIS 定数

**Files:**
- Create/Modify: `packages/shared/src/constants.ts`（無ければ新規。既に定数ファイルがあればそこに追記）
- Create: `packages/shared/src/schemas/comment.ts`
- Create: `packages/shared/src/schemas/comment.test.ts`
- Modify: `packages/shared/src/index.ts`（barrel が wildcard re-export でなければ追記）

**Interfaces:**
- Produces: `REACTION_EMOJIS`（`readonly string[]`、Task 4/7 が使用）、`createCommentSchema` / `updateCommentSchema`（Task 3/5/6 が使用）、`reactionSchema`（Task 4/5 が使用）。

- [ ] **Step 1: REACTION_EMOJIS 定数**

`constants.ts`:

```ts
/** リアクションで使える絵文字プリセット（この順で UI に表示）。サーバー検証の唯一の真実 */
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '🙌', '👀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
```

- [ ] **Step 2: comment.ts スキーマ**

既存スキーマ（`article.ts` 等）の import 流儀・`z` の使い方に合わせる:

```ts
import { z } from 'zod';
import { REACTION_EMOJIS } from '../constants';

export const createCommentSchema = z.object({
  bodyMd: z.string().trim().min(1).max(5000),
  parentId: z.string().uuid().optional(),
});

export const updateCommentSchema = z.object({
  bodyMd: z.string().trim().min(1).max(5000),
});

export const reactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
});
```

- [ ] **Step 3: スキーマテスト**

`comment.test.ts` に既存スキーマテストの流儀で:
- `createCommentSchema`: (1) `{ bodyMd: 'hello' }` を通す・`parentId` は任意 (2) 空文字 `bodyMd` を拒否 (3) 5001 文字を拒否 (4) `parentId` に非 UUID を拒否。
- `reactionSchema`: (1) プリセット絵文字 `'👍'` を通す (2) プリセット外 `'💩'` を拒否。

- [ ] **Step 4: barrel に re-export を追加**

`packages/shared/src/index.ts` は per-file の明示 `export *`（`export * from './schemas/auth'` 等）。ワイルドカードではないので、以下 2 行を追加する:

```ts
export * from './constants';
export * from './schemas/comment';
```

- [ ] **Step 5: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/shared test && pnpm typecheck`
Expected: shared テスト green、全パッケージ typecheck クリーン。`@knowledge-hub/shared` から `REACTION_EMOJIS` / `createCommentSchema` / `reactionSchema` が import できることを確認。

```bash
git add packages/shared
git commit -m "feat(shared): add comment schemas and reaction emoji preset"
```

---

### Task 3: CommentService（TDD）

**Files:**
- Modify: `apps/server/src/services/permissions.ts`
- Create: `apps/server/src/services/comment-service.ts`
- Create: `apps/server/src/services/comment-service.test.ts`

**Interfaces:**
- Consumes: Task 1 の `comments` テーブル、既存 `articles` スキーマ、`can()`（`apps/server/src/services/permissions.ts`、`Action` union + `resource?: { authorId? }` シグネチャ）、`AppError`。
- Produces: 拡張した `can()`（`comment:edit` / `comment:delete`）、`createComment` / `listComments` / `updateComment` / `deleteComment`（Task 5 が使用）、`CommentNode` 型（トップレベル + `replies` 配列）。

- [ ] **Step 0: permissions.ts に comment アクションを追加**

`can()` は `Action` union（`'article:edit'` 等）+ `resource?: { authorId?: string }` の形。既存の article edit/delete と**同じ意味論**でコメント用を追加する（編集は作成者のみ、削除は作成者 or admin）:

```ts
export type Action =
  | 'user:manage'
  | 'article:create'
  | 'article:edit'
  | 'article:delete'
  | 'article:pin'
  | 'category:manage'
  | 'comment:edit'
  | 'comment:delete';

// switch に追加:
    case 'comment:edit':
      return resource?.authorId === user.id;             // 作成者のみ（admin でも他人のコメントは編集不可）
    case 'comment:delete':
      return user.role === 'admin' || resource?.authorId === user.id;  // 作成者 or admin
```

`can()` は網羅的 switch（default なし）なので、新ケースを足さないと型エラーになる — これが追加漏れの検出になる。

**設計指針:**
- カーソル・ページングは既存 `article-service.ts` の `pagePublished` 流儀（複合カーソル + `limit + 1` 判定）を踏襲するが、**トップレベルコメントは古い順（`created_at asc, id asc`）**でページングする（議論を上から読むため）。返信は各トップレベルにぶら下げて**まとめて 1 クエリ**で取得する（`inArray(parentId, 取得したトップレベル id 群)`、返信も `created_at asc`）。
- 対象記事の公開・未削除チェックを**作成・取得の両方**で行う（Global Constraints）。ヘルパ `assertPublishedArticle(db, articleId)`（不在/下書き/削除なら `AppError('NOT_FOUND', ..., 404)`）を service 内に持つ。
- 削除済みコメントは一覧に残すが `bodyMd` を返さない。返す形は `{ id, articleId, authorId, authorName, parentId, bodyMd: string | null, isDeleted: boolean, createdAt, updatedAt, replies }`（削除済みは `bodyMd: null, isDeleted: true`）。

- [ ] **Step 1: 失敗するテストを書く**

`comment-service.test.ts`（既存サービステストの Testcontainers 流儀・fixture の作り方を `article-service.test.ts` に合わせる）。カバーするケース:

1. トップレベルコメントを作成 → 取得一覧に出る（`bodyMd`・`authorName` 含む）
2. 返信を作成（`parentId` = トップレベル）→ そのトップレベルの `replies` に入る
3. **返信への返信を拒否**（`parentId` = 既に子のコメント → `VALIDATION` 400）
4. **他記事のコメントを parent に指定して拒否**（`parentId` が別記事のコメント → `VALIDATION` 400）
5. **下書き記事へのコメント作成を拒否**（`NOT_FOUND` 404）／不在記事も 404
6. コメント編集（作成者）→ `bodyMd` 更新・`updatedAt` が進む
7. **他人のコメントを編集しようとして拒否**（`FORBIDDEN` 403）
8. コメント削除（作成者）→ 一覧には残るが `bodyMd: null, isDeleted: true`、`replies` は保持される
9. **admin は他人のコメントを削除できる**（`isDeleted: true` になる）
10. **member は他人のコメントを削除できない**（`FORBIDDEN` 403）
11. カーソルページング: トップレベルを limit=1 で 2 ページ取得、古い順・重複なし

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @knowledge-hub/server test -- src/services/comment-service.test.ts`
Expected: FAIL（comment-service.ts が無い）

- [ ] **Step 3: 実装**

`assertPublishedArticle` ヘルパ・1 階層検証（parent を引いて `parent.articleId === articleId` かつ `parent.parentId === null` を確認、崩れれば `AppError('VALIDATION', ..., 400)`）・`can()` による編集/削除権限チェック・カーソル encode/decode（`pagePublished` と同じ base64url 形式、ただしキーは `created_at asc` 用に `gt` 比較）を実装する。既存コードを読んで idiom を合わせること。削除・編集は `updatedAt` を更新。返信のまとめ取得は取得したトップレベル id 群への 1 クエリ。

> **通知の差し込み点（3c 用）**: `createComment` の成功後が「自分の記事へのコメント / 自分のコメントへの返信」通知を生成する箇所になる。このフェーズでは**何も生成しない**が、後で 3c が最小差分で足せるよう、作成結果（新コメントの id・articleId・parentId・記事著者・親コメント著者）が関数末尾で分かる形にしておく（コメントを 1 行入れておくとよい）。

- [ ] **Step 4: PASS を確認**

Run: `pnpm --filter @knowledge-hub/server test -- src/services/comment-service.test.ts`
Expected: 全 11 ケース PASS

- [ ] **Step 5: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`

```bash
git add apps/server
git commit -m "feat(server): add comment service with 1-level replies and soft delete"
```

---

### Task 4: EngagementService（リアクション + ブックマーク + まとめ取得、TDD）

**Files:**
- Create: `apps/server/src/services/engagement-service.ts`
- Create: `apps/server/src/services/engagement-service.test.ts`

**Interfaces:**
- Consumes: Task 1 の `reactions` / `bookmarks` テーブル、Task 3 の `assertPublishedArticle`（export して再利用するか、engagement-service にも同等ヘルパを置く。**重複を避けるため Task 3 の `assertPublishedArticle` を export して共有する**）、Task 2 の `REACTION_EMOJIS`。
- Produces: `addReaction` / `removeReaction` / `addBookmark` / `removeBookmark` / `listBookmarks` / `getEngagement`（Task 5 が使用）、`ArticleEngagement` 型（`{ reactions: Record<string, number>; myReactions: string[]; bookmarked: boolean; commentCount: number }`）。

**設計指針:**
- `addReaction`: `(userId, articleId, emoji)`。記事の公開チェック後、`insert ... on conflict do nothing`（ユニーク制約で冪等）。`removeReaction`: 該当行を delete。どちらもトグルの片側で、クライアントが現在状態から呼び分ける。
- `toggleBookmark` は使わず**明示的な** `addBookmark` / `removeBookmark`（`on conflict do nothing` / delete）にする（楽観的更新をしない = サーバー状態が真なので明示操作が素直）。
- `getEngagement(db, userId, articleId)`: 公開チェック後、(a) 絵文字ごとの件数（`group by emoji`）(b) 自分がした絵文字（`where userId=me`）(c) 自分がブックマーク済みか (d) 未削除コメント件数（`comments where article_id=? and deleted_at is null` の count）をまとめて返す。件数マップは `REACTION_EMOJIS` の全キーを 0 埋めして返す（UI が全プリセットを常に描画できるように）。
- `listBookmarks(db, userId, { cursor, limit })`: 自分がブックマークした**公開・未削除**記事を `bookmarks.created_at desc` でカーソルページング。返す各要素は記事一覧カード用の形（既存 `LIST_COLUMNS` 相当 + `bookmarkedAt`）。非公開化/削除された記事はブックマークが残っていても一覧に出さない（join で `status='published' and deleted_at is null` を効かせる）。

- [ ] **Step 1: 失敗するテストを書く**

`engagement-service.test.ts`。ケース:

1. `addReaction` → `getEngagement` の `reactions['👍']` が 1、`myReactions` に `'👍'`
2. 同じリアクションを 2 回 `addReaction` → 冪等（件数 1 のまま、例外なし）
3. `removeReaction` → 件数 0、`myReactions` から消える
4. 別ユーザーの同絵文字リアクション → 件数 2、自分の `myReactions` は自分の分だけ
5. **下書き記事への `addReaction` を拒否**（`NOT_FOUND` 404）
6. `addBookmark` → `getEngagement.bookmarked === true`、`removeBookmark` → false、2 回 add は冪等
7. `listBookmarks`: 追加した記事が出る。**非公開化した記事はブックマークが残っていても一覧に出ない**
8. `getEngagement.commentCount`: 未削除コメント 2 + 削除済み 1 → `commentCount === 2`
9. `getEngagement.reactions` は全プリセット絵文字キーを持つ（未使用の絵文字は 0）
10. `listBookmarks` カーソルページング（limit=1 で 2 ページ、`created_at desc`、重複なし）

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @knowledge-hub/server test -- src/services/engagement-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

`assertPublishedArticle`（Task 3 から import）を使う。件数集計は drizzle の `sql`/`count`、`group by`。`listBookmarks` は `bookmarks` と `articles`（+ `users` で authorName）を join し公開・未削除で絞る。カーソルは `article-service` の `pagePublished` と同じ base64url 形式だが、キーは `bookmarks.created_at desc, bookmarks.id desc`。

> **通知の差し込み点（3c 用）**: `addReaction` の成功後が「自分の記事へのリアクション」通知の生成箇所になる。このフェーズでは生成しない。作成結果（articleId・記事著者・actor・emoji）が末尾で分かる形にしておく。

- [ ] **Step 4: PASS を確認**

Run: `pnpm --filter @knowledge-hub/server test -- src/services/engagement-service.test.ts`
Expected: 全 10 ケース PASS

- [ ] **Step 5: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`

```bash
git add apps/server
git commit -m "feat(server): add reaction and bookmark engagement service"
```

---

### Task 5: ルート（コメント / リアクション / ブックマーク / engagement）

**Files:**
- Create: `apps/server/src/routes/comments.ts`
- Create: `apps/server/src/routes/comments.test.ts`
- Create: `apps/server/src/routes/engagement.ts`
- Create: `apps/server/src/routes/engagement.test.ts`
- Modify: `apps/server/src/app.ts`（ルート配線）

**Interfaces:**
- Consumes: Task 2 スキーマ、Task 3/4 サービス関数、既存 `requireAuth` / `validate` ミドルウェア、`c.get('db')`、`c.get('user')`（既存の認証済みユーザー取得の流儀に合わせる）。
- Produces（Task 6/7/8 が hc 経由で使用）:
  - `GET /api/articles/:id/comments?cursor=&limit=` → `{ items: CommentNode[], nextCursor }`
  - `POST /api/articles/:id/comments`（body: createCommentSchema）→ 作成コメント
  - `PATCH /api/comments/:commentId`（body: updateCommentSchema）→ 更新コメント
  - `DELETE /api/comments/:commentId` → 204/200
  - `GET /api/articles/:id/engagement` → `ArticleEngagement`
  - `POST /api/articles/:id/reactions`（body: reactionSchema）→ 追加後の engagement もしくは 204
  - `DELETE /api/articles/:id/reactions/:emoji` → 削除後 204（`:emoji` は URL エンコード。ハンドラで `REACTION_EMOJIS` に含まれるか検証、外なら 400）
  - `POST /api/articles/:id/bookmark` → 204、`DELETE /api/articles/:id/bookmark` → 204
  - `GET /api/me/bookmarks?cursor=&limit=` → `{ items, nextCursor }`

- [ ] **Step 1: comments.ts 実装**

既存ルート（`articles.ts` 等）の `new Hono<AppEnv>().use(requireAuth)...` 流儀・`validate('json'|'query'|'param', schema)` の使い方・`c.req.param()` の取り方に合わせる。`:id`（記事）と `:commentId` の UUID 検証は Phase 3a の `requireValidUuid` パターンに倣い不正形式を 404/400 で弾く（記事 id は 404、コメント id は 404）。各ハンドラはサービス関数へ委譲するのみ。`listQuerySchema`（既存のカーソル+limit スキーマ）を再利用できるならする。

- [ ] **Step 2: engagement.ts 実装**

同様に薄く。`/api/me/bookmarks` は `/api/articles/:id/...` とは別ルーターにして良い（配線しやすい方でよいが、`app.ts` で両方を配線する）。`DELETE /reactions/:emoji` は `decodeURIComponent` 後に `REACTION_EMOJIS.includes` で検証。

- [ ] **Step 3: app.ts に配線**

既存の `.route('/api/articles', articleRoutes)` 等と同じ流儀で新ルーターを配線する。**サービスは関数 export（deps 注入不要）なので `buildApp` の deps は変更しない**想定 — ただし既存 article/user routes が deps をどう受けているか確認し、それに合わせる（もし search のように interface 注入が必要な設計なら踏襲。基本は article-service と同じく関数 import で足りるはず）。既存テストヘルパの変更が不要であることを確認する。

- [ ] **Step 4: ルートテスト（配線の検証。ロジックは Task 3/4 で網羅済み）**

`comments.test.ts`: (1) 未認証 → 401 (2) 公開記事にコメント POST → 201/200 と本文 (3) 下書き記事にコメント POST → 404 (4) 他人のコメント DELETE を member が → 403 (5) コメント一覧 GET の形。
`engagement.test.ts`: (1) 未認証 → 401 (2) リアクション POST → engagement に反映 (3) プリセット外 emoji → 400 (4) bookmark POST → `GET /me/bookmarks` に出る (5) `GET /articles/:id/engagement` の形。

- [ ] **Step 5: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck && pnpm typecheck`
Expected: 既存 136 + 新規 green、全体 typecheck クリーン。

```bash
git add apps/server
git commit -m "feat(server): expose comment, reaction, bookmark endpoints"
```

---

### Task 6: Web コメント欄（記事詳細）

**Files:**
- Create: `apps/web/src/components/CommentSection.tsx`
- Create: `apps/web/src/components/CommentSection.test.tsx`
- Modify: `apps/web/src/pages/ArticleDetailPage.tsx`（`<CommentSection articleId={...} />` を本文の下に追加）

**Interfaces:**
- Consumes: Task 5 の comments エンドポイント（hc 経由 `api.api.articles[':id'].comments.$get` 等、正確な呼び出し形は既存の hc 呼び出しを読んで合わせる）、既存 `Markdown` コンポーネント（`@/lib/markdown`）、`Loading` / `EmptyState` / `Button` / `Textarea`（無ければ `components/ui` の既存 input 系）、`useMe`（自分の id で編集/削除ボタンの出し分け）。

- [ ] **Step 1: CommentSection 実装**

- `useInfiniteQuery(['comments', articleId])` でトップレベル + `replies` を取得。「もっと見る」で `fetchNextPage`。
- 各コメント: 著者名（`/users/:authorId` リンク、既存 ArticleCard と同じ流儀）+ `createdAt` + 本文。**本文は削除済みなら「削除されました」（`text-muted-foreground italic`）、そうでなければ `<Markdown source={bodyMd} />`**。
- 投稿フォーム: プレーン `<textarea>`（`aria-label="コメント"`）+ 「コメントする」ボタン。送信は `useMutation`、成功で `invalidateQueries(['comments', articleId])` と `['engagement', articleId]`（コメント数更新）。**楽観的更新はしない**（送信中はボタン disabled + スピナー）。
- 返信: 各トップレベルに「返信」ボタン → インラインの返信 textarea（`parentId` 付きで POST）。返信は 1 階層のみ（返信への「返信」ボタンは出さない）。
- 編集/削除: **自分のコメントのみ**「編集」「削除」を表示（`me?.id === comment.authorId`）。admin は他人のコメントにも「削除」を表示（`me?.role === 'admin'`）。編集はインライン textarea → PATCH。削除は確認（既存の確認 UI 流儀。無ければ `window.confirm` ではなく shadcn の流儀に合わせるが、既存に確認ダイアログが無ければシンプルに削除ボタン 2 度押し確認か、既存パターン踏襲）。削除成功で `invalidateQueries`。
- エラーは既存の `role="status"`/`role="alert"` 流儀でインライン表示。

- [ ] **Step 2: ArticleDetailPage に埋め込み**

本文レンダリングの下に `<CommentSection articleId={article.id} />` を追加。**既存の本文表示・著者リンク（3a で追加）・編集ボタン等は変更しない。**

- [ ] **Step 3: テスト**

既存ページテストの流儀（api クライアントをモック）で: (1) コメント一覧が描画される（本文が Markdown 描画される）(2) 削除済みコメントが「削除されました」表示 (3) 投稿フォーム送信で POST が呼ばれ invalidate される (4) 自分のコメントに編集/削除が出て、他人のには出ない（member 視点）。

- [ ] **Step 4: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`

```bash
git add apps/web
git commit -m "feat(web): add comment section to article detail"
```

---

### Task 7: Web リアクションバー（楽観的更新）

**Files:**
- Create: `apps/web/src/components/ReactionBar.tsx`
- Create: `apps/web/src/components/ReactionBar.test.tsx`
- Modify: `apps/web/src/pages/ArticleDetailPage.tsx`（`<ReactionBar articleId={...} />` を本文と CommentSection の間に）

**Interfaces:**
- Consumes: Task 5 の `GET /api/articles/:id/engagement`・`POST /reactions`・`DELETE /reactions/:emoji`、Task 2 の `REACTION_EMOJIS`。

- [ ] **Step 1: ReactionBar 実装**

- `useQuery(['engagement', articleId])` で `{ reactions, myReactions, bookmarked, commentCount }` を取得（この query は BookmarkButton とも共有する）。
- `REACTION_EMOJIS` を横並びのトグルボタンで描画。各ボタン: 絵文字 + 件数。自分が押していれば `variant` を強調（`bg-accent` 等トークン）。
- クリックで**楽観的更新**（設計 §9）: `useMutation` の `onMutate` で `['engagement', articleId]` のキャッシュを直接更新（押下 → 件数 +1・`myReactions` に追加 / 取消 → -1・削除）、`onError` でロールバック（`context` に前値保存）、`onSettled` で `invalidateQueries(['engagement', articleId])`。押していなければ POST、押していれば DELETE を呼ぶ。
- 件数 0 の絵文字も常に全プリセット表示（`getEngagement` が 0 埋めで返す）。

- [ ] **Step 2: ArticleDetailPage に配置**

本文の下・CommentSection の上に `<ReactionBar articleId={article.id} />`。

- [ ] **Step 3: テスト**

(1) engagement の件数・自分の押下状態が描画される (2) 未押下の絵文字クリックで即座に件数が +1 され（楽観的）POST が呼ばれる (3) 押下済みをクリックで -1 され DELETE が呼ばれる (4) API 失敗で件数が元に戻る（ロールバック）。fetch/mutation をモックし、楽観反映とロールバックを assert。

- [ ] **Step 4: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`

```bash
git add apps/web
git commit -m "feat(web): add reaction bar with optimistic updates"
```

---

### Task 8: Web ブックマーク（ボタン + 一覧ページ + ナビ）

**Files:**
- Create: `apps/web/src/components/BookmarkButton.tsx`
- Create: `apps/web/src/pages/BookmarksPage.tsx`
- Create: `apps/web/src/pages/BookmarksPage.test.tsx`
- Modify: `apps/web/src/pages/ArticleDetailPage.tsx`（`<BookmarkButton articleId={...} />` を記事ヘッダ付近の操作列に）
- Modify: `apps/web/src/components/Layout.tsx`（ナビに「ブックマーク」リンク `/me/bookmarks`）
- Modify: `apps/web/src/App.tsx`（`/me/bookmarks` ルート）

**Interfaces:**
- Consumes: Task 5 の `POST/DELETE /api/articles/:id/bookmark`・`GET /api/me/bookmarks`・`GET /engagement`（`bookmarked` を読む）、既存 `ArticleList` / `Loading` / `EmptyState`。

- [ ] **Step 1: BookmarkButton 実装**

- `useQuery(['engagement', articleId])`（ReactionBar と共有キャッシュ）の `bookmarked` を読む。
- トグルボタン（ブックマーク済み = 塗り、未 = 枠。`lucide-react` の `Bookmark` アイコン、`aria-pressed`）。
- クリックで `useMutation`（**楽観的更新はしない** — 設計 §9。送信中 disabled、成功で `invalidateQueries(['engagement', articleId])`）。`bookmarked` に応じて POST/DELETE。

- [ ] **Step 2: BookmarksPage 実装**

- `useInfiniteQuery(['bookmarks'])` → `GET /api/me/bookmarks`。`ArticleList`（emptyText「ブックマークした記事はまだありません。」）で描画。「もっと見る」対応。ロード中 `Loading`。
- ページ見出し `<h1>ブックマーク</h1>`（既存ページの見出し流儀に合わせる）。

- [ ] **Step 3: ナビ + ルート**

`Layout.tsx` のナビ（「記事を書く」の近く）に `/me/bookmarks` への「ブックマーク」リンクを追加（既存リンクの流儀・トークン踏襲、他リンクは不変）。`App.tsx` に `/me/bookmarks` ルート。

- [ ] **Step 4: テスト**

`BookmarksPage.test.tsx`: (1) ブックマーク一覧が描画される (2) 0 件で EmptyState 文言。
`BookmarkButton`（同ファイル or ArticleDetail テストに追記）: (3) 未ブックマークでクリック → POST が呼ばれ invalidate、(4) ブックマーク済み表示。

- [ ] **Step 5: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`

```bash
git add apps/web
git commit -m "feat(web): add bookmark button and bookmarks page"
```

---

### Task 9: 全体検証

**Files:** なし（検証のみ。問題が出たら該当タスクの流儀で修正）

- [ ] **Step 1: 全部入りの検証**

```bash
pnpm --filter @knowledge-hub/web test
pnpm --filter @knowledge-hub/web typecheck
pnpm --filter @knowledge-hub/web check:contrast
pnpm --filter @knowledge-hub/web build
pnpm --filter @knowledge-hub/server test
pnpm typecheck
```
Expected: すべて green / ok / クリーン。

- [ ] **Step 2: 未コミット残がないことを確認**

```bash
git status --short
```

---

## 完了後の検証（コントローラーが実施）

1. dev サーバー（実 DB）でブラウザ通し: 公開記事詳細を開く → コメント投稿 → 返信 → 自分のコメント編集・削除（「削除されました」表示・返信ツリー保持）→ リアクション押下/取消（楽観反映）→ ブックマーク → `/me/bookmarks` に出る → 非公開化した記事がブックマーク一覧から消えること → ダークテーマ確認。
2. 別ユーザー（member）で他人のコメントに編集/削除が出ないこと、admin では削除が出ることを確認。
3. 下書き記事へコメント/リアクション/ブックマークの API が 404 になること（直接 curl）。
4. `notifications` テーブルに 3b の操作で行が一切作られないことを確認（`select count(*) from notifications` が 0 のまま）。
