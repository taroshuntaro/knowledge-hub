# Phase 3c: 通知・メンション Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アプリ内通知（ベル + 未読バッジ + 一覧 + 既読管理）と @メンション（コメント・記事本文の検出 + コメント欄オートコンプリート）を実装する。

**Architecture:** 通知生成は新設の `notification-service.ts` に集約し（設計 §3）、3b で用意済みの seam（`createComment` / `addReaction` の成功後）と記事の publish / update 経路から呼び出す。メンションは Markdown 原文中の `[@表示名](/users/<uuid>)` リンク記法を正規表現で検出し、UUID を DB 照合して通知先を確定する。Web はヘッダーのベル（30 秒ポーリング）+ `/notifications` ページ + コメント欄の @ オートコンプリート。

**Tech Stack:** Hono + Drizzle + PostgreSQL（Testcontainers 実 DB テスト）、React 19 + TanStack Query + hono client `hc<AppType>`、shadcn/ui + Tailwind v4 デザイントークン、lucide-react。

## Global Constraints

- **通知生成はサービス層 1 箇所に集約**（設計 §3）: notifications テーブルへの insert は `apps/server/src/services/notification-service.ts` の中だけで行う。他サービス・ルートは notification-service の関数を呼ぶのみ。
- **トリガーは 4 種のみ**（設計 §8 / §4 の enum と一致）: 自分の記事へのコメント `comment` / 自分のコメントへの返信 `reply` / 自分の記事へのリアクション `reaction` / @メンション `mention`。
- **新着記事は通知しない。自分自身の行動では通知を生成しない**（設計 §8 原文どおり）。
- **メンション記法は `[@表示名](/users/<uuid>)`**（2026-07-07 ユーザー決定）。検出はコメント本文・記事本文の**両方**。オートコンプリート UI は**コメント欄のみ**（記事エディタは手入力・ペーストされた記法を検出するだけ）。
- **メンション通知の対象は実在かつ `isActive` なユーザーのみ**。抽出した UUID は DB 照合してから通知する。
- **1 イベント（1 コメント投稿）につき同一受信者への通知は最大 1 件。優先度は mention > reply > comment**。
- **リアクション通知のスパム防止**: reactions への insert が実際に起きたときのみ通知し、さらに同一 actor × 記事の**未読** reaction 通知が残っている間は追加しない（既読後の再リアクションは新規通知になる）。
- **記事本文メンションは publish 時と published 記事の update 時に検出。draft 保存では通知しない**。同一記事 × 受信者に既にメンション通知（既読含む・`commentId IS NULL` のもの）があれば再通知しない（編集のたびの再通知防止）。
- **コメント編集で追加されたメンションも通知する**。ただしそのコメントについて既に通知（種別問わず）済みの受信者には出さない。
- **通知一覧と未読数は同じ可視条件を共有する**: 対象記事が `status = 'published'` かつ `deleted_at IS NULL`（ゴミ箱行き・非公開化された記事の通知は一覧にも未読数にも出ない）。
- **カーソルページングは確立済みパターンに従う**: WHERE と ORDER BY の両方で同一の `sql`date_trunc('milliseconds', col)`` ローカル式を共有し、タイブレークは自テーブル id、カーソルは base64url `${ISO}|${id}`。decodeCursor の malformed → 500 は既存 3 サービスと同じ既知課題（横断修正の follow-up 対象が 4 箇所になる。台帳に記録済み）。
- **不正な UUID パスパラメータは DB に到達する前に 404**（`AppError('NOT_FOUND', ...)`、`routes/comments.ts` の `requireValidArticleId` と同型）。
- **GET /api/users（メンション候補）は `id` / `displayName` / `avatarUrl` のみ返す。email は絶対に返さない**（テストで email 欠如を assert する）。
- **エラーは AppError `{code, message}` 契約**。全 API は `requireAuth` 配下。
- **テストは Testcontainers（postgres:16-alpine、pg_bigm なし）の実 DB**。通知テストは検索機能に依存しないこと。
- **UI は shadcn/ui + Tailwind v4 デザイントークンのみ（生 hex 禁止）、アイコンは lucide-react**。未読バッジは 30 秒ポーリング（`refetchInterval: 30_000`。SSE/WebSocket は V1 スコープ外）。
- **通知クリックは `/articles/:articleId` へ遷移**（コメントアンカーは将来課題）。
- **コミットは Conventional Commits（英語・subject 小文字開始）、1 タスク 1 コミット**。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `apps/server/src/db/schema.ts`（変更） | `notification_type` enum + `notifications` テーブル追加 |
| `apps/server/drizzle/0004_notifications.sql`（生成） | migration |
| `apps/server/src/services/mention.ts`（新規） | Markdown からのメンション UUID 抽出（純関数） |
| `apps/server/src/services/notification-service.ts`（新規） | 通知の生成（notify*）と読み取り（list / unread / read）すべて |
| `apps/server/src/services/comment-service.ts`（変更） | createComment / updateComment に通知呼び出しを配線 |
| `apps/server/src/services/engagement-service.ts`（変更） | addReaction に通知呼び出しを配線 |
| `apps/server/src/services/article-service.ts`（変更） | publishArticle / updateArticle に記事メンション通知を配線 |
| `apps/server/src/services/user-service.ts`（変更） | `listMentionCandidates` 追加 |
| `apps/server/src/routes/notifications.ts`（新規） | GET / ・GET /unread-count・POST /:id/read・POST /read-all |
| `apps/server/src/routes/users.ts`（変更） | GET /（メンション候補一覧）追加 |
| `apps/server/src/app.ts`（変更） | `.route('/api/notifications', notificationRoutes)` 追加 |
| `apps/web/src/lib/notification-message.ts`（新規） | 通知 → 表示文言の変換 + `NotificationItem` 型（ベルとページで共用） |
| `apps/web/src/components/NotificationBell.tsx`（新規） | ヘッダーのベル + 未読バッジ + 直近 5 件ポップオーバー |
| `apps/web/src/pages/NotificationsPage.tsx`（新規） | `/notifications` 一覧（無限スクロール・既読管理・全て既読） |
| `apps/web/src/components/MentionTextarea.tsx`（新規） | @ トリガーの候補ポップアップ付き textarea |
| `apps/web/src/components/CommentSection.tsx`（変更） | CommentForm の Textarea を MentionTextarea に差し替え |
| `apps/web/src/components/Layout.tsx`（変更） | ヘッダーに NotificationBell 追加 |
| `apps/web/src/App.tsx`（変更） | `/notifications` ルート追加 |

**3c で触らないもの:** Tiptap / CodeMirror エディタ（オートコンプリートなし）、Markdown レンダラー `apps/web/src/lib/markdown.tsx`（`[@名前](/users/id)` は既存のサニタイズ済みリンク描画でそのままプロフィールリンクになるため変更不要）、`apps/server/src/test/helpers.ts` の `resetDb`（notifications は users/articles の truncate cascade で消える）。

---

### Task 1: notifications スキーマ + migration

**Files:**
- Modify: `apps/server/src/db/schema.ts`（末尾に追記）
- Create: `apps/server/drizzle/0004_*.sql`（drizzle-kit 生成）
- Test: `apps/server/src/db/notifications-schema.test.ts`

**Interfaces:**
- Consumes: 既存の `users` / `articles` / `comments` テーブル定義。
- Produces: `notificationTypeEnum`（'comment' | 'reply' | 'reaction' | 'mention'）と `notifications` テーブル。カラム: `id` uuid PK、`recipientId` uuid NOT NULL FK→users cascade、`type` enum NOT NULL、`actorId` uuid NOT NULL FK→users cascade、`articleId` uuid NOT NULL FK→articles cascade、`commentId` uuid nullable FK→comments cascade、`readAt` timestamptz nullable、`createdAt` timestamptz NOT NULL default now()。インデックス `notifications_recipient_created_idx` on (recipientId, createdAt)。Task 3 以降がこれを import する。

- [ ] **Step 1: schema.ts にテーブル定義を追記**

`apps/server/src/db/schema.ts` の末尾（bookmarks の後）に追加。enum 定義はファイル先頭の既存 enum 群（`articleStatusEnum` の下）に置く:

```ts
export const notificationTypeEnum = pgEnum('notification_type', ['comment', 'reply', 'reaction', 'mention']);
```

末尾に:

```ts
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    articleId: uuid('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    recipientCreatedIdx: index('notifications_recipient_created_idx').on(t.recipientId, t.createdAt),
  }),
);
```

- [ ] **Step 2: migration を生成**

Run: `pnpm --filter @knowledge-hub/server db:generate`
Expected: `apps/server/drizzle/0004_<name>.sql` が生成され、`drizzle/meta/_journal.json` に idx 4 のエントリが追加される。生成 SQL に `CREATE TYPE "public"."notification_type"` と `CREATE TABLE "notifications"` と FK 4 本（cascade）とインデックスが含まれることを目視確認。

- [ ] **Step 3: スモークテストを書く**

`apps/server/src/db/notifications-schema.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { comments, notifications } from './schema';
import { createTestArticle, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('notifications schema', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('挿入と取得ができ、readAt は null で始まる', async () => {
    const recipient = await createTestUser(ctx.db);
    const actor = await createTestUser(ctx.db);
    const article = await createTestArticle(ctx.db, { authorId: recipient.id });
    const [row] = await ctx.db
      .insert(notifications)
      .values({ recipientId: recipient.id, type: 'comment', actorId: actor.id, articleId: article.id })
      .returning();
    expect(row.readAt).toBeNull();
    expect(row.type).toBe('comment');
    expect(row.commentId).toBeNull();
  });

  it('コメント削除（物理）で通知が cascade 削除される', async () => {
    const recipient = await createTestUser(ctx.db);
    const actor = await createTestUser(ctx.db);
    const article = await createTestArticle(ctx.db, { authorId: recipient.id });
    const [comment] = await ctx.db
      .insert(comments)
      .values({ articleId: article.id, authorId: actor.id, bodyMd: 'hi' })
      .returning();
    await ctx.db.insert(notifications).values({
      recipientId: recipient.id, type: 'comment', actorId: actor.id,
      articleId: article.id, commentId: comment.id,
    });
    await ctx.db.delete(comments).where(eq(comments.id, comment.id));
    const rows = await ctx.db.select().from(notifications);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 4: テスト実行**

Run: `pnpm --filter @knowledge-hub/server test -- notifications-schema`
Expected: PASS（global-setup が 0004 を含む全 migration を適用する）

- [ ] **Step 5: 全体確認 + コミット**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`
Expected: 既存テストすべて PASS

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle apps/server/src/db/notifications-schema.test.ts
git commit -m "feat(server): add notifications table and migration"
```

---

### Task 2: メンション抽出ユーティリティ

**Files:**
- Create: `apps/server/src/services/mention.ts`
- Test: `apps/server/src/services/mention.test.ts`

**Interfaces:**
- Consumes: なし（純関数、DB 非依存）。
- Produces: `extractMentionedUserIds(bodyMd: string): string[]` — `[@表示名](/users/<uuid>)` 形式のリンクから UUID を抽出し、小文字に正規化して重複排除した配列を返す。コードブロック（``` フェンス）・インラインコード内は無視する。Task 3 が import する。

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/mention.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractMentionedUserIds } from './mention';

const U1 = '47395b74-5d75-487d-9ee6-481eb4c32ebc';
const U2 = '11111111-2222-4333-8444-555555555555';

describe('extractMentionedUserIds', () => {
  it('リンク記法のメンションから UUID を抽出する', () => {
    expect(extractMentionedUserIds(`お疲れさまです [@田中](/users/${U1}) さん`)).toEqual([U1]);
  });

  it('複数メンションを順に返し、同一ユーザーは重複排除する', () => {
    const body = `[@田中](/users/${U1}) と [@佐藤](/users/${U2})、再度 [@田中](/users/${U1})`;
    expect(extractMentionedUserIds(body)).toEqual([U1, U2]);
  });

  it('大文字 UUID は小文字に正規化する', () => {
    expect(extractMentionedUserIds(`[@X](/users/${U1.toUpperCase()})`)).toEqual([U1]);
  });

  it('コードフェンス内・インラインコード内のメンションは無視する', () => {
    const body = '```\n[@a](/users/' + U1 + ')\n```\nと `[@b](/users/' + U2 + ')` はコード';
    expect(extractMentionedUserIds(body)).toEqual([]);
  });

  it('UUID 形式でないリンク・@ なしのユーザーリンクは無視する', () => {
    expect(extractMentionedUserIds('[@x](/users/not-a-uuid) [田中](/users/' + U1 + ')')).toEqual([]);
  });

  it('メンションのない本文は空配列', () => {
    expect(extractMentionedUserIds('通常の [リンク](https://example.com) だけ')).toEqual([]);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/server test -- mention`
Expected: FAIL（mention.ts が存在しない）

- [ ] **Step 3: 実装**

`apps/server/src/services/mention.ts`:

```ts
// メンション記法: [@表示名](/users/<uuid>)（2026-07-07 決定）。
// UUID を DB 照合するのは notification-service 側。ここは構文抽出のみ。
const MENTION_RE =
  /\[@[^\]]*\]\(\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export function extractMentionedUserIds(bodyMd: string): string[] {
  // コードブロック・インラインコード内の記法は本文と見なさない（buildSearchText と同じ方針）
  const withoutCode = bodyMd.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const ids = new Set<string>();
  for (const m of withoutCode.matchAll(MENTION_RE)) ids.add(m[1].toLowerCase());
  return [...ids];
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `pnpm --filter @knowledge-hub/server test -- mention`
Expected: 6/6 PASS

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/services/mention.ts apps/server/src/services/mention.test.ts
git commit -m "feat(server): add mention extraction from markdown"
```

---

### Task 3: notification-service 書き込み側

**Files:**
- Create: `apps/server/src/services/notification-service.ts`
- Test: `apps/server/src/services/notification-service.test.ts`

**Interfaces:**
- Consumes: Task 1 の `notifications` テーブル、Task 2 の `extractMentionedUserIds`。
- Produces（Task 5 が import する）:
  - `notifyCommentCreated(db: Db, input: { comment: { id: string; articleId: string; authorId: string; bodyMd: string; parentId: string | null }; articleAuthorId: string; parentAuthorId: string | null }): Promise<void>`
  - `notifyCommentMentionsOnEdit(db: Db, comment: { id: string; articleId: string; authorId: string; bodyMd: string }): Promise<void>`
  - `notifyReactionAdded(db: Db, input: { actorId: string; articleId: string; articleAuthorId: string }): Promise<void>`
  - `notifyArticleMentions(db: Db, article: { id: string; authorId: string; bodyMd: string }): Promise<void>`
  - `NotificationRecord = typeof notifications.$inferSelect`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/notification-service.test.ts`（このタスクでは書き込み側の describe のみ。Task 4 が読み取り側 describe を追記する）:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { notifications } from '../db/schema';
import { createTestArticle, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  notifyArticleMentions,
  notifyCommentCreated,
  notifyCommentMentionsOnEdit,
  notifyReactionAdded,
} from './notification-service';

describe('notification-service 書き込み', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function setup() {
    const author = await createTestUser(ctx.db);
    const actor = await createTestUser(ctx.db);
    const article = await createTestArticle(ctx.db, {
      authorId: author.id, status: 'published', publishedAt: new Date(),
    });
    return { author, actor, article };
  }

  const all = () => ctx.db.select().from(notifications);

  describe('notifyCommentCreated', () => {
    it('他人の記事へのコメントで記事著者に comment 通知', async () => {
      const { author, actor, article } = await setup();
      await notifyCommentCreated(ctx.db, {
        comment: { id: crypto.randomUUID(), articleId: article.id, authorId: actor.id, bodyMd: 'hi', parentId: null },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      const rows = await all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ recipientId: author.id, type: 'comment', actorId: actor.id });
    });

    it('自分の記事への自分のコメントは通知なし', async () => {
      const { author, article } = await setup();
      await notifyCommentCreated(ctx.db, {
        comment: { id: crypto.randomUUID(), articleId: article.id, authorId: author.id, bodyMd: 'memo', parentId: null },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      expect(await all()).toHaveLength(0);
    });

    it('返信では親コメント著者に reply、記事著者に comment（別人の場合）', async () => {
      const { author, actor, article } = await setup();
      const parentAuthor = await createTestUser(ctx.db);
      await notifyCommentCreated(ctx.db, {
        comment: { id: crypto.randomUUID(), articleId: article.id, authorId: actor.id, bodyMd: 're', parentId: crypto.randomUUID() },
        articleAuthorId: author.id,
        parentAuthorId: parentAuthor.id,
      });
      const rows = await all();
      expect(rows).toHaveLength(2);
      const types = Object.fromEntries(rows.map((r) => [r.recipientId, r.type]));
      expect(types[author.id]).toBe('comment');
      expect(types[parentAuthor.id]).toBe('reply');
    });

    it('親コメント著者 = 記事著者なら reply 1 件のみ（受信者ごと最大 1 件、reply > comment）', async () => {
      const { author, actor, article } = await setup();
      await notifyCommentCreated(ctx.db, {
        comment: { id: crypto.randomUUID(), articleId: article.id, authorId: actor.id, bodyMd: 're', parentId: crypto.randomUUID() },
        articleAuthorId: author.id,
        parentAuthorId: author.id,
      });
      const rows = await all();
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('reply');
    });

    it('記事著者へのメンション入りコメントは mention 1 件のみ（mention > comment）', async () => {
      const { author, actor, article } = await setup();
      await notifyCommentCreated(ctx.db, {
        comment: {
          id: crypto.randomUUID(), articleId: article.id, authorId: actor.id,
          bodyMd: `[@著者](/users/${author.id}) 確認お願いします`, parentId: null,
        },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      const rows = await all();
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('mention');
    });

    it('第三者メンションは mention、実在しない UUID と inactive ユーザーは無視', async () => {
      const { author, actor, article } = await setup();
      const third = await createTestUser(ctx.db);
      const inactive = await createTestUser(ctx.db, { isActive: false });
      const ghost = crypto.randomUUID();
      await notifyCommentCreated(ctx.db, {
        comment: {
          id: crypto.randomUUID(), articleId: article.id, authorId: actor.id,
          bodyMd: `[@a](/users/${third.id}) [@b](/users/${inactive.id}) [@c](/users/${ghost})`, parentId: null,
        },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      const rows = await all();
      // author への comment + third への mention の 2 件
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.recipientId === third.id)?.type).toBe('mention');
    });

    it('自分自身へのメンションは通知なし', async () => {
      const { author, actor, article } = await setup();
      await notifyCommentCreated(ctx.db, {
        comment: {
          id: crypto.randomUUID(), articleId: article.id, authorId: actor.id,
          bodyMd: `セルフ [@俺](/users/${actor.id})`, parentId: null,
        },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      const rows = await all();
      expect(rows).toHaveLength(1); // author への comment のみ
      expect(rows[0].recipientId).toBe(author.id);
    });
  });

  describe('notifyCommentMentionsOnEdit', () => {
    it('編集で追加されたメンションは通知され、同一コメントで通知済みの相手には出ない', async () => {
      const { author, actor, article } = await setup();
      const third = await createTestUser(ctx.db);
      const commentId = crypto.randomUUID();
      // 作成時: author に comment 通知
      await notifyCommentCreated(ctx.db, {
        comment: { id: commentId, articleId: article.id, authorId: actor.id, bodyMd: 'v1', parentId: null },
        articleAuthorId: author.id,
        parentAuthorId: null,
      });
      // 編集で author と third をメンション
      await notifyCommentMentionsOnEdit(ctx.db, {
        id: commentId, articleId: article.id, authorId: actor.id,
        bodyMd: `[@著者](/users/${author.id}) [@三者](/users/${third.id})`,
      });
      const rows = await all();
      // author は作成時の comment 通知で通知済み → 追加なし。third の mention のみ増える。
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.recipientId === third.id)?.type).toBe('mention');
      // 再編集（同内容）→ 増えない
      await notifyCommentMentionsOnEdit(ctx.db, {
        id: commentId, articleId: article.id, authorId: actor.id,
        bodyMd: `[@著者](/users/${author.id}) [@三者](/users/${third.id})`,
      });
      expect(await all()).toHaveLength(2);
    });
  });

  describe('notifyReactionAdded', () => {
    it('記事著者に reaction 通知、自分の記事なら通知なし', async () => {
      const { author, actor, article } = await setup();
      await notifyReactionAdded(ctx.db, { actorId: actor.id, articleId: article.id, articleAuthorId: author.id });
      expect(await all()).toHaveLength(1);
      await notifyReactionAdded(ctx.db, { actorId: author.id, articleId: article.id, articleAuthorId: author.id });
      expect(await all()).toHaveLength(1);
    });

    it('同一 actor × 記事の未読 reaction 通知が残っている間は追加しない', async () => {
      const { author, actor, article } = await setup();
      await notifyReactionAdded(ctx.db, { actorId: actor.id, articleId: article.id, articleAuthorId: author.id });
      await notifyReactionAdded(ctx.db, { actorId: actor.id, articleId: article.id, articleAuthorId: author.id });
      expect(await all()).toHaveLength(1);
    });
  });

  describe('notifyArticleMentions', () => {
    it('本文メンションで通知し、再実行では同一受信者に再通知しない', async () => {
      const { author, article } = await setup();
      const third = await createTestUser(ctx.db);
      const body = `紹介 [@三者](/users/${third.id})`;
      await notifyArticleMentions(ctx.db, { id: article.id, authorId: author.id, bodyMd: body });
      expect(await all()).toHaveLength(1);
      await notifyArticleMentions(ctx.db, { id: article.id, authorId: author.id, bodyMd: body });
      expect(await all()).toHaveLength(1);
    });

    it('編集で追加されたメンションだけ新規通知される', async () => {
      const { author, article } = await setup();
      const a = await createTestUser(ctx.db);
      const b = await createTestUser(ctx.db);
      await notifyArticleMentions(ctx.db, { id: article.id, authorId: author.id, bodyMd: `[@a](/users/${a.id})` });
      await notifyArticleMentions(ctx.db, {
        id: article.id, authorId: author.id, bodyMd: `[@a](/users/${a.id}) [@b](/users/${b.id})`,
      });
      const rows = await all();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => r.recipientId))).toEqual(new Set([a.id, b.id]));
    });

    it('自分メンションのみなら通知なし', async () => {
      const { author, article } = await setup();
      await notifyArticleMentions(ctx.db, {
        id: article.id, authorId: author.id, bodyMd: `[@自分](/users/${author.id})`,
      });
      expect(await all()).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/server test -- notification-service`
Expected: FAIL（notification-service.ts が存在しない）

- [ ] **Step 3: 実装**

`apps/server/src/services/notification-service.ts`:

```ts
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { notifications, users } from '../db/schema';
import type { Db } from '../types';
import { extractMentionedUserIds } from './mention';

export type NotificationRecord = typeof notifications.$inferSelect;

/** 本文中のメンション UUID を実在するアクティブユーザーに絞り込む（actor 本人は除外） */
async function resolveMentionRecipients(db: Db, bodyMd: string, actorId: string): Promise<string[]> {
  const ids = extractMentionedUserIds(bodyMd).filter((id) => id !== actorId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)));
  return rows.map((r) => r.id);
}

export async function notifyCommentCreated(
  db: Db,
  input: {
    comment: { id: string; articleId: string; authorId: string; bodyMd: string; parentId: string | null };
    articleAuthorId: string;
    parentAuthorId: string | null;
  },
): Promise<void> {
  const actorId = input.comment.authorId;
  // 1 イベントにつき受信者ごとに最大 1 通知。後から set する種別が勝つ（mention > reply > comment）
  const byRecipient = new Map<string, 'comment' | 'reply' | 'mention'>();
  if (input.articleAuthorId !== actorId) byRecipient.set(input.articleAuthorId, 'comment');
  if (input.parentAuthorId && input.parentAuthorId !== actorId) byRecipient.set(input.parentAuthorId, 'reply');
  for (const id of await resolveMentionRecipients(db, input.comment.bodyMd, actorId)) {
    byRecipient.set(id, 'mention');
  }
  if (byRecipient.size === 0) return;
  await db.insert(notifications).values(
    [...byRecipient].map(([recipientId, type]) => ({
      recipientId,
      type,
      actorId,
      articleId: input.comment.articleId,
      commentId: input.comment.id,
    })),
  );
}

export async function notifyCommentMentionsOnEdit(
  db: Db,
  comment: { id: string; articleId: string; authorId: string; bodyMd: string },
): Promise<void> {
  const recipients = await resolveMentionRecipients(db, comment.bodyMd, comment.authorId);
  if (recipients.length === 0) return;
  // このコメントで既に通知（種別問わず・既読含む）済みの相手には再通知しない
  const existing = await db
    .select({ recipientId: notifications.recipientId })
    .from(notifications)
    .where(and(eq(notifications.commentId, comment.id), inArray(notifications.recipientId, recipients)));
  const notified = new Set(existing.map((r) => r.recipientId));
  const fresh = recipients.filter((id) => !notified.has(id));
  if (fresh.length === 0) return;
  await db.insert(notifications).values(
    fresh.map((recipientId) => ({
      recipientId,
      type: 'mention' as const,
      actorId: comment.authorId,
      articleId: comment.articleId,
      commentId: comment.id,
    })),
  );
}

export async function notifyReactionAdded(
  db: Db,
  input: { actorId: string; articleId: string; articleAuthorId: string },
): Promise<void> {
  if (input.articleAuthorId === input.actorId) return;
  // トグル連打のスパム防止: 同一 actor × 記事の未読 reaction 通知が残っていれば追加しない
  const existing = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.recipientId, input.articleAuthorId),
      eq(notifications.type, 'reaction'),
      eq(notifications.actorId, input.actorId),
      eq(notifications.articleId, input.articleId),
      isNull(notifications.readAt),
    ),
  });
  if (existing) return;
  await db.insert(notifications).values({
    recipientId: input.articleAuthorId,
    type: 'reaction',
    actorId: input.actorId,
    articleId: input.articleId,
  });
}

export async function notifyArticleMentions(
  db: Db,
  article: { id: string; authorId: string; bodyMd: string },
): Promise<void> {
  const recipients = await resolveMentionRecipients(db, article.bodyMd, article.authorId);
  if (recipients.length === 0) return;
  // 同一記事で既に本文メンション通知（既読含む）済みの相手には再通知しない
  const existing = await db
    .select({ recipientId: notifications.recipientId })
    .from(notifications)
    .where(
      and(
        eq(notifications.articleId, article.id),
        eq(notifications.type, 'mention'),
        isNull(notifications.commentId),
        inArray(notifications.recipientId, recipients),
      ),
    );
  const notified = new Set(existing.map((r) => r.recipientId));
  const fresh = recipients.filter((id) => !notified.has(id));
  if (fresh.length === 0) return;
  await db.insert(notifications).values(
    fresh.map((recipientId) => ({
      recipientId,
      type: 'mention' as const,
      actorId: article.authorId,
      articleId: article.id,
    })),
  );
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `pnpm --filter @knowledge-hub/server test -- notification-service`
Expected: 全 PASS

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/services/notification-service.ts apps/server/src/services/notification-service.test.ts
git commit -m "feat(server): add notification write-side service"
```

---

### Task 4: notification-service 読み取り側

**Files:**
- Modify: `apps/server/src/services/notification-service.ts`（末尾に追記）
- Test: `apps/server/src/services/notification-service.test.ts`（読み取り側 describe を追記）

**Interfaces:**
- Consumes: Task 3 の notification-service。`articles` / `users` テーブル。
- Produces（Task 6 が import する）:
  - `NotificationItem = { id: string; type: 'comment' | 'reply' | 'reaction' | 'mention'; actorId: string; actorName: string; articleId: string; articleTitle: string; commentId: string | null; readAt: Date | null; createdAt: Date }`
  - `listNotifications(db: Db, userId: string, page: { cursor?: string; limit: number }): Promise<{ items: NotificationItem[]; nextCursor: string | null }>` — createdAt 降順、可視条件（記事 published かつ未削除）
  - `countUnread(db: Db, userId: string): Promise<number>` — 同じ可視条件
  - `markRead(db: Db, userId: string, id: string): Promise<void>` — 自分の通知のみ、既読済みは変更しない、他人の id は no-op（存在オラクルなし）
  - `markAllRead(db: Db, userId: string): Promise<void>`

- [ ] **Step 1: 失敗するテストを追記**

`apps/server/src/services/notification-service.test.ts` に describe を追加:

```ts
// 既存 import に追記:
import { desc, sql } from 'drizzle-orm';
import { articles } from '../db/schema';
import { countUnread, listNotifications, markAllRead, markRead } from './notification-service';

describe('notification-service 読み取り', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function seed() {
    const me = await createTestUser(ctx.db);
    const actor = await createTestUser(ctx.db, { displayName: 'アクター' });
    const article = await createTestArticle(ctx.db, {
      authorId: me.id, title: '対象記事', status: 'published', publishedAt: new Date(),
    });
    return { me, actor, article };
  }

  it('自分宛の通知だけを新しい順に返し、actorName と articleTitle を含む', async () => {
    const { me, actor, article } = await seed();
    const other = await createTestUser(ctx.db);
    await ctx.db.insert(notifications).values([
      { recipientId: me.id, type: 'comment', actorId: actor.id, articleId: article.id },
      { recipientId: other.id, type: 'comment', actorId: actor.id, articleId: article.id },
    ]);
    const page = await listNotifications(ctx.db, me.id, { limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      type: 'comment', actorName: 'アクター', articleTitle: '対象記事', articleId: article.id,
    });
  });

  it('カーソルページングが動作し、同一 ms 内の µs 差でも行が欠落しない', async () => {
    const { me, actor, article } = await seed();
    // 同一 ms・異 µs、かつ「µs が早い行ほど UUID が大きい」逆転を直接 insert して
    // 丸め漏れ（WHERE/ORDER BY 精度不一致）を決定的に検出する（3b と同じパターン）
    const bigId = '00000000-0000-4000-8000-00000000000a';
    const smallId = '00000000-0000-4000-8000-000000000001';
    await ctx.db.execute(sql`
      insert into notifications (id, recipient_id, type, actor_id, article_id, created_at) values
      (${bigId}, ${me.id}, 'comment', ${actor.id}, ${article.id}, '2026-01-01T00:00:00.000100Z'),
      (${smallId}, ${me.id}, 'reply', ${actor.id}, ${article.id}, '2026-01-01T00:00:00.000900Z')
    `);
    const page1 = await listNotifications(ctx.db, me.id, { limit: 1 });
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listNotifications(ctx.db, me.id, { cursor: page1.nextCursor!, limit: 1 });
    const ids = [...page1.items, ...page2.items].map((n) => n.id);
    expect(new Set(ids)).toEqual(new Set([bigId, smallId]));
  });

  it('対象記事がゴミ箱 or 非公開なら一覧にも未読数にも出ない', async () => {
    const { me, actor, article } = await seed();
    await ctx.db.insert(notifications).values({
      recipientId: me.id, type: 'reaction', actorId: actor.id, articleId: article.id,
    });
    expect(await countUnread(ctx.db, me.id)).toBe(1);
    await ctx.db.update(articles).set({ deletedAt: new Date() }).where(sql`id = ${article.id}`);
    expect(await countUnread(ctx.db, me.id)).toBe(0);
    expect((await listNotifications(ctx.db, me.id, { limit: 20 })).items).toHaveLength(0);
  });

  it('markRead は自分の通知のみ既読化し、他人の id では何も起きない', async () => {
    const { me, actor, article } = await seed();
    const other = await createTestUser(ctx.db);
    const [mine] = await ctx.db.insert(notifications).values({
      recipientId: me.id, type: 'comment', actorId: actor.id, articleId: article.id,
    }).returning();
    const [theirs] = await ctx.db.insert(notifications).values({
      recipientId: other.id, type: 'comment', actorId: actor.id, articleId: article.id,
    }).returning();
    await markRead(ctx.db, me.id, mine.id);
    await markRead(ctx.db, me.id, theirs.id); // 他人のもの → no-op
    const rows = await ctx.db.select().from(notifications).orderBy(desc(notifications.createdAt));
    expect(rows.find((r) => r.id === mine.id)?.readAt).not.toBeNull();
    expect(rows.find((r) => r.id === theirs.id)?.readAt).toBeNull();
  });

  it('markAllRead で自分の未読が全て既読になり countUnread が 0 になる', async () => {
    const { me, actor, article } = await seed();
    await ctx.db.insert(notifications).values([
      { recipientId: me.id, type: 'comment', actorId: actor.id, articleId: article.id },
      { recipientId: me.id, type: 'reaction', actorId: actor.id, articleId: article.id },
    ]);
    expect(await countUnread(ctx.db, me.id)).toBe(2);
    await markAllRead(ctx.db, me.id);
    expect(await countUnread(ctx.db, me.id)).toBe(0);
  });
});
```

注意: このテストファイルには describe が 2 つになり、それぞれが `createTestApp()` を持つ。既存の書き込み側 describe の `ctx` と衝突しないよう、読み取り側 describe 内に自分の `ctx` を持つこと（上記コードの通り）。

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/server test -- notification-service`
Expected: 読み取り側 describe が FAIL（関数未定義）、書き込み側は PASS のまま

- [ ] **Step 3: 実装を追記**

`apps/server/src/services/notification-service.ts` の import を拡張し、末尾に追記:

```ts
// import 行を以下に更新:
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { articles, notifications, users } from '../db/schema';
```

```ts
export type NotificationItem = {
  id: string;
  type: 'comment' | 'reply' | 'reaction' | 'mention';
  actorId: string;
  actorName: string;
  articleId: string;
  articleTitle: string;
  commentId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export type Page<T> = { items: T[]; nextCursor: string | null };

function encodeCursor(sortKey: Date, id: string): string {
  return Buffer.from(`${sortKey.toISOString()}|${id}`).toString('base64url');
}
function decodeCursor(cursor: string): { sortKey: string; id: string } {
  const [sortKey, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  return { sortKey, id };
}

// 一覧と未読数が共有する可視条件: 対象記事が公開中かつ未削除
const visibleArticle = () => and(eq(articles.status, 'published'), isNull(articles.deletedAt));

export async function listNotifications(
  db: Db,
  userId: string,
  page: { cursor?: string; limit: number },
): Promise<Page<NotificationItem>> {
  const base = and(eq(notifications.recipientId, userId), visibleArticle());
  // created_at は DB の now()（µs 精度）、カーソルは JS Date（ms 精度）。WHERE と ORDER BY の
  // 両方で同じ date_trunc('milliseconds', ...) キーを使わないと同一 ms バケット内で行が
  // 永久欠落しうる（comment/bookmark カーソルと同じ確立パターン）。
  const createdAtMs = sql`date_trunc('milliseconds', ${notifications.createdAt})`;
  const where = page.cursor
    ? and(
        base,
        (() => {
          const c = decodeCursor(page.cursor!);
          const cursorDate = new Date(c.sortKey);
          return or(
            sql`${createdAtMs} < ${cursorDate}`,
            and(sql`${createdAtMs} = ${cursorDate}`, lt(notifications.id, c.id)),
          );
        })(),
      )
    : base;

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      actorId: notifications.actorId,
      actorName: users.displayName,
      articleId: notifications.articleId,
      articleTitle: articles.title,
      commentId: notifications.commentId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .innerJoin(users, eq(notifications.actorId, users.id))
    .innerJoin(articles, eq(notifications.articleId, articles.id))
    .where(where)
    .orderBy(desc(createdAtMs), desc(notifications.id))
    .limit(page.limit + 1);

  const items = rows.slice(0, page.limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > page.limit ? encodeCursor(last.createdAt, last.id) : null;
  return { items, nextCursor };
}

export async function countUnread(db: Db, userId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .innerJoin(articles, eq(notifications.articleId, articles.id))
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt), visibleArticle()));
  return count;
}

export async function markRead(db: Db, userId: string, id: string): Promise<void> {
  // 自分の未読のみ更新。他人の id・既読済みは no-op（204 のまま、存在オラクルなし）
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.recipientId, userId), isNull(notifications.readAt)));
}

export async function markAllRead(db: Db, userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `pnpm --filter @knowledge-hub/server test -- notification-service`
Expected: 全 PASS。µs タイブレークテストが本当に精度不一致を検出することを確認するため、一時的に `.orderBy(desc(notifications.createdAt), desc(notifications.id))`（生カラム）に変えてテストが FAIL する（RED になる）ことを確認してから戻すこと。

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/services/notification-service.ts apps/server/src/services/notification-service.test.ts
git commit -m "feat(server): add notification list, unread count, and read APIs"
```

---

### Task 5: seam 配線（コメント・リアクション・記事）

**Files:**
- Modify: `apps/server/src/services/comment-service.ts`（createComment / updateComment）
- Modify: `apps/server/src/services/engagement-service.ts`（addReaction）
- Modify: `apps/server/src/services/article-service.ts`（publishArticle / updateArticle）
- Test: `apps/server/src/services/notification-wiring.test.ts`（新規）

**Interfaces:**
- Consumes: Task 3 の `notifyCommentCreated` / `notifyCommentMentionsOnEdit` / `notifyReactionAdded` / `notifyArticleMentions`。
- Produces: 既存関数のシグネチャ・戻り値は**一切変えない**（web 側の hc 型推論に影響なし）。副作用として通知が生成されるだけ。

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/notification-wiring.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { notifications, users } from '../db/schema';
import { createTestArticle, createTestCategory, createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { publishArticle, updateArticle } from './article-service';
import { createComment, updateComment } from './comment-service';
import { addBookmark, addReaction, removeBookmark, removeReaction } from './engagement-service';

function asSession(u: typeof users.$inferSelect): SessionUser {
  return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, avatarUrl: u.avatarUrl, bio: u.bio };
}

describe('通知の seam 配線', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  const all = () => ctx.db.select().from(notifications);

  async function setup() {
    const author = await createTestUser(ctx.db);
    const actor = await createTestUser(ctx.db);
    const article = await createTestArticle(ctx.db, {
      authorId: author.id, status: 'published', publishedAt: new Date(),
    });
    return { author, actor, article };
  }

  it('createComment: 記事著者に comment 通知が入る', async () => {
    const { author, actor, article } = await setup();
    await createComment(ctx.db, article.id, asSession(actor), { bodyMd: 'こんにちは' });
    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientId: author.id, type: 'comment', actorId: actor.id });
    expect(rows[0].commentId).not.toBeNull();
  });

  it('createComment: 返信で親コメント著者に reply 通知が入る', async () => {
    const { actor, article } = await setup();
    const parentAuthor = await createTestUser(ctx.db);
    const parent = await createComment(ctx.db, article.id, asSession(parentAuthor), { bodyMd: '親' });
    await ctx.db.delete(notifications); // 親作成分をクリア
    await createComment(ctx.db, article.id, asSession(actor), { bodyMd: '返信', parentId: parent.id });
    const rows = await all();
    expect(rows.find((r) => r.recipientId === parentAuthor.id)?.type).toBe('reply');
  });

  it('updateComment: 編集で追加したメンションが通知される', async () => {
    const { actor, article } = await setup();
    const third = await createTestUser(ctx.db);
    const comment = await createComment(ctx.db, article.id, asSession(actor), { bodyMd: 'v1' });
    await ctx.db.delete(notifications);
    await updateComment(ctx.db, comment.id, asSession(actor), {
      bodyMd: `v2 [@三者](/users/${third.id})`,
    });
    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientId: third.id, type: 'mention', commentId: comment.id });
  });

  it('addReaction: 記事著者に reaction 通知。既存リアクションへの再 POST（conflict）では増えない', async () => {
    const { author, actor, article } = await setup();
    await addReaction(ctx.db, actor.id, article.id, '👍');
    expect(await all()).toHaveLength(1);
    await addReaction(ctx.db, actor.id, article.id, '👍'); // conflict → insert なし → 通知なし
    expect(await all()).toHaveLength(1);
  });

  it('addReaction: 外して付け直しても未読が残っていれば増えない', async () => {
    const { actor, article } = await setup();
    await addReaction(ctx.db, actor.id, article.id, '👍');
    await removeReaction(ctx.db, actor.id, article.id, '👍');
    await addReaction(ctx.db, actor.id, article.id, '👍');
    expect(await all()).toHaveLength(1);
  });

  it('ブックマークの追加・削除は通知を一切生成しない', async () => {
    const { actor, article } = await setup();
    await addBookmark(ctx.db, actor.id, article.id);
    await removeBookmark(ctx.db, actor.id, article.id);
    expect(await all()).toHaveLength(0);
  });

  it('自分の記事への自分のコメント・リアクションは通知なし', async () => {
    const { author, article } = await setup();
    await createComment(ctx.db, article.id, asSession(author), { bodyMd: 'セルフ' });
    await addReaction(ctx.db, author.id, article.id, '👍');
    expect(await all()).toHaveLength(0);
  });

  it('publishArticle: 本文メンションが publish 時に通知される（draft 保存では通知されない）', async () => {
    const author = await createTestUser(ctx.db);
    const third = await createTestUser(ctx.db);
    const cat = await createTestCategory(ctx.db);
    const draft = await createTestArticle(ctx.db, {
      authorId: author.id, categoryId: cat.id, status: 'draft',
      bodyMd: `紹介 [@三者](/users/${third.id})`,
    });
    expect(await all()).toHaveLength(0); // draft 作成では通知なし
    await publishArticle(ctx.db, draft.id, asSession(author));
    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientId: third.id, type: 'mention', articleId: draft.id });
    expect(rows[0].commentId).toBeNull();
  });

  it('updateArticle: published 記事の編集で追加メンションのみ通知、draft の編集では通知なし', async () => {
    const author = await createTestUser(ctx.db);
    const a = await createTestUser(ctx.db);
    const b = await createTestUser(ctx.db);
    const cat = await createTestCategory(ctx.db);
    const article = await createTestArticle(ctx.db, {
      authorId: author.id, categoryId: cat.id, status: 'published', publishedAt: new Date(),
      bodyMd: `[@a](/users/${a.id})`,
    });

    await updateArticle(ctx.db, article.id, asSession(author), {
      title: article.title,
      bodyMd: `[@a](/users/${a.id}) [@b](/users/${b.id})`,
      categoryId: cat.id,
      tags: [],
      expectedUpdatedAt: article.updatedAt.toISOString(),
    });
    const rows = await all();
    // dedupe（通知済み受信者のスキップ）自体の検証は Task 3 で済んでいる。
    // ここでは published 記事の update が通知経路に乗ることを確認する。
    expect(new Set(rows.map((r) => r.recipientId))).toEqual(new Set([a.id, b.id]));

    // draft の編集では通知されない
    const draftArt = await createTestArticle(ctx.db, {
      authorId: author.id, categoryId: cat.id, status: 'draft', bodyMd: '',
    });
    await ctx.db.delete(notifications);
    await updateArticle(ctx.db, draftArt.id, asSession(author), {
      title: 'd', bodyMd: `[@a](/users/${a.id})`, categoryId: cat.id, tags: [],
      expectedUpdatedAt: draftArt.updatedAt.toISOString(),
    });
    expect(await all()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/server test -- notification-wiring`
Expected: FAIL（通知が生成されない）

- [ ] **Step 3: comment-service を配線**

`apps/server/src/services/comment-service.ts` の `createComment` を変更。parent の取得結果を保持し、insert 後に通知。**3c 用 seam コメント（`// 通知の差し込み点（3c 用）...` と `void article;`）は削除する**:

```ts
// import に追加:
import { notifyCommentCreated, notifyCommentMentionsOnEdit } from './notification-service';
```

```ts
export async function createComment(
  db: Db,
  articleId: string,
  author: SessionUser,
  input: { bodyMd: string; parentId?: string },
): Promise<CommentRecord> {
  const article = await assertPublishedArticle(db, articleId);

  let parent: CommentRecord | null = null;
  if (input.parentId) {
    parent = (await db.query.comments.findFirst({ where: eq(comments.id, input.parentId) })) ?? null;
    if (!parent || parent.articleId !== articleId || parent.parentId !== null) {
      throw new AppError('VALIDATION', '返信先のコメントが不正です', 400);
    }
  }

  const [row] = await db
    .insert(comments)
    .values({
      articleId,
      authorId: author.id,
      parentId: input.parentId ?? null,
      bodyMd: input.bodyMd,
    })
    .returning();

  await notifyCommentCreated(db, {
    comment: row,
    articleAuthorId: article.authorId,
    parentAuthorId: parent?.authorId ?? null,
  });

  return row;
}
```

`updateComment` は update 成功後・return 前に 1 行追加:

```ts
  await notifyCommentMentionsOnEdit(db, row);
  return row;
```

- [ ] **Step 4: engagement-service を配線**

`apps/server/src/services/addReaction` を変更（seam コメントと `void article;` は削除）:

```ts
// import に追加:
import { notifyReactionAdded } from './notification-service';
```

```ts
export async function addReaction(db: Db, userId: string, articleId: string, emoji: string): Promise<void> {
  const article = await assertPublishedArticle(db, articleId);
  const inserted = await db
    .insert(reactions)
    .values({ userId, articleId, emoji })
    .onConflictDoNothing({ target: [reactions.userId, reactions.articleId, reactions.emoji] })
    .returning({ id: reactions.id });
  // 既存行との衝突（同じリアクションの再 POST）では insert が起きないので通知もしない
  if (inserted.length > 0) {
    await notifyReactionAdded(db, { actorId: userId, articleId, articleAuthorId: article.authorId });
  }
}
```

- [ ] **Step 5: article-service を配線**

`apps/server/src/services/article-service.ts`:

```ts
// import に追加:
import { notifyArticleMentions } from './notification-service';
```

`publishArticle` の `return row;` 直前に:

```ts
  await notifyArticleMentions(db, row);
```

`updateArticle` の `await snapshot(db, row);` の後・`return row;` の前に:

```ts
  // 記事本文メンションは公開状態でのみ通知（draft 保存では通知しない）
  if (row.status === 'published') await notifyArticleMentions(db, row);
```

- [ ] **Step 6: テスト成功 + 全体確認**

Run: `pnpm --filter @knowledge-hub/server test`
Expected: notification-wiring 全 PASS + 既存テスト（comment / engagement / article）もすべて PASS

- [ ] **Step 7: コミット**

```bash
git add apps/server/src/services/comment-service.ts apps/server/src/services/engagement-service.ts apps/server/src/services/article-service.ts apps/server/src/services/notification-wiring.test.ts
git commit -m "feat(server): generate notifications from comment, reaction, and article seams"
```

---

### Task 6: 通知ルート + メンション候補エンドポイント

**Files:**
- Create: `apps/server/src/routes/notifications.ts`
- Modify: `apps/server/src/routes/users.ts`（GET / 追加）
- Modify: `apps/server/src/services/user-service.ts`（`listMentionCandidates` 追加）
- Modify: `apps/server/src/app.ts`（route 追加）
- Test: `apps/server/src/routes/notifications.test.ts`

**Interfaces:**
- Consumes: Task 4 の `listNotifications` / `countUnread` / `markRead` / `markAllRead`。shared の `listQuerySchema`（cursor + limit、既存）。
- Produces（web が hc 経由で使う）:
  - `GET /api/notifications?cursor&limit` → `{ items: NotificationItem[]; nextCursor: string | null }`
  - `GET /api/notifications/unread-count` → `{ count: number }`
  - `POST /api/notifications/:notificationId/read` → 204
  - `POST /api/notifications/read-all` → 204
  - `GET /api/users` → `{ id: string; displayName: string; avatarUrl: string | null }[]`（isActive のみ、displayName 昇順）

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/routes/notifications.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCategory, createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('notification routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function login(email: string): Promise<string> {
    await createTestUser(ctx.db, { email });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }
  const j = (cookie: string, body: unknown = {}, method = 'POST') => ({
    method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie },
  });

  // author が記事を公開し、actor がコメント → author に通知が 1 件できる状態を作る
  async function seedNotification() {
    const authorCookie = await login('author@example.com');
    const cat = await createTestCategory(ctx.db);
    const created = await (await ctx.app.request('/api/articles', j(authorCookie, {
      title: '記事', bodyMd: '本文', categoryId: cat.id, tags: [],
    }))).json();
    await ctx.app.request(`/api/articles/${created.id}/publish`, j(authorCookie));
    const actorCookie = await login('actor@example.com');
    await ctx.app.request(`/api/articles/${created.id}/comments`, j(actorCookie, { bodyMd: 'こんにちは' }));
    return { authorCookie, actorCookie, articleId: created.id as string };
  }

  it('未認証は全エンドポイントで 401', async () => {
    for (const [path, method] of [
      ['/api/notifications', 'GET'],
      ['/api/notifications/unread-count', 'GET'],
      ['/api/notifications/read-all', 'POST'],
      ['/api/users', 'GET'],
    ] as const) {
      const res = await ctx.app.request(path, { method });
      expect(res.status, path).toBe(401);
    }
  });

  it('一覧と未読数が自分宛のものだけを返す', async () => {
    const { authorCookie, actorCookie } = await seedNotification();
    const mine = await (await ctx.app.request('/api/notifications', { headers: { cookie: authorCookie } })).json();
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].type).toBe('comment');
    expect(mine.items[0].actorName).toBeTruthy();
    expect(mine.items[0].articleTitle).toBe('記事');
    const count = await (await ctx.app.request('/api/notifications/unread-count', { headers: { cookie: authorCookie } })).json();
    expect(count.count).toBe(1);
    const others = await (await ctx.app.request('/api/notifications', { headers: { cookie: actorCookie } })).json();
    expect(others.items).toHaveLength(0);
  });

  it('POST /:id/read で既読になり、他人の通知 id でも 204（no-op）', async () => {
    const { authorCookie, actorCookie } = await seedNotification();
    const mine = await (await ctx.app.request('/api/notifications', { headers: { cookie: authorCookie } })).json();
    const id = mine.items[0].id as string;
    // 他人（actor）が author の通知を既読化しようとしても no-op
    const foreign = await ctx.app.request(`/api/notifications/${id}/read`, j(actorCookie));
    expect(foreign.status).toBe(204);
    let count = await (await ctx.app.request('/api/notifications/unread-count', { headers: { cookie: authorCookie } })).json();
    expect(count.count).toBe(1);
    // 本人による既読化
    const own = await ctx.app.request(`/api/notifications/${id}/read`, j(authorCookie));
    expect(own.status).toBe(204);
    count = await (await ctx.app.request('/api/notifications/unread-count', { headers: { cookie: authorCookie } })).json();
    expect(count.count).toBe(0);
  });

  it('不正な UUID の read は 404、read-all は 204 で全既読', async () => {
    const { authorCookie } = await seedNotification();
    const bad = await ctx.app.request('/api/notifications/not-a-uuid/read', j(authorCookie));
    expect(bad.status).toBe(404);
    const res = await ctx.app.request('/api/notifications/read-all', j(authorCookie));
    expect(res.status).toBe(204);
    const count = await (await ctx.app.request('/api/notifications/unread-count', { headers: { cookie: authorCookie } })).json();
    expect(count.count).toBe(0);
  });

  it('GET /api/users は active ユーザーの id/displayName/avatarUrl のみ返し、email を含まない', async () => {
    const cookie = await login('viewer@example.com');
    await createTestUser(ctx.db, { displayName: '休眠', isActive: false });
    const res = await ctx.app.request('/api/users', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((u: { displayName: string }) => u.displayName === '休眠')).toBe(false);
    for (const u of body) {
      expect(Object.keys(u).sort()).toEqual(['avatarUrl', 'displayName', 'id']);
    }
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/server test -- routes/notifications`
Expected: FAIL（ルート未実装で 404）

- [ ] **Step 3: notification ルートを実装**

`apps/server/src/routes/notifications.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { listQuerySchema } from '@knowledge-hub/shared';
import { AppError } from '../errors';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { countUnread, listNotifications, markAllRead, markRead } from '../services/notification-service';
import type { AppEnv } from '../types';

function requireValidNotificationId(id: string): void {
  // 不正な UUID 形式は DB エラー（500）ではなく NOT_FOUND として扱う
  if (!z.string().uuid().safeParse(id).success) {
    throw new AppError('NOT_FOUND', '通知が見つかりません', 404);
  }
}

export const notificationRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', validate('query', listQuerySchema), async (c) =>
    c.json(await listNotifications(c.get('db'), c.get('user').id, c.req.valid('query'))))
  .get('/unread-count', async (c) =>
    c.json({ count: await countUnread(c.get('db'), c.get('user').id) }))
  .post('/read-all', async (c) => {
    await markAllRead(c.get('db'), c.get('user').id);
    return c.body(null, 204);
  })
  .post('/:notificationId/read', async (c) => {
    requireValidNotificationId(c.req.param('notificationId'));
    await markRead(c.get('db'), c.get('user').id, c.req.param('notificationId'));
    return c.body(null, 204);
  });
```

- [ ] **Step 4: メンション候補エンドポイントを実装**

`apps/server/src/services/user-service.ts` に追記:

```ts
export type MentionCandidate = { id: string; displayName: string; avatarUrl: string | null };

/** メンション候補（@ オートコンプリート用）。email 等の非公開情報は絶対に含めない。 */
export async function listMentionCandidates(db: Db): Promise<MentionCandidate[]> {
  return db
    .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(users.displayName);
}
```

`apps/server/src/routes/users.ts` の `.use(requireAuth)` の直後にルートを追加（`/:id` より前）:

```ts
  .get('/', async (c) => c.json(await listMentionCandidates(c.get('db'))))
```

import に `listMentionCandidates` を追加。

- [ ] **Step 5: app.ts に配線**

`apps/server/src/app.ts` に import と route を追加:

```ts
import { notificationRoutes } from './routes/notifications';
```

`.route('/api/me', meRoutes)` の下に:

```ts
    .route('/api/notifications', notificationRoutes)
```

- [ ] **Step 6: テスト成功 + 全体確認**

Run: `pnpm --filter @knowledge-hub/server test && pnpm -r typecheck`
Expected: 全 PASS（既存 users ルートのテストも回帰なし）

- [ ] **Step 7: コミット**

```bash
git add apps/server/src/routes/notifications.ts apps/server/src/routes/notifications.test.ts apps/server/src/routes/users.ts apps/server/src/services/user-service.ts apps/server/src/app.ts
git commit -m "feat(server): add notification routes and mention candidates endpoint"
```

---

### Task 7: Web — 通知ベル + 通知一覧ページ

**Files:**
- Create: `apps/web/src/lib/notification-message.ts`
- Create: `apps/web/src/components/NotificationBell.tsx`
- Create: `apps/web/src/pages/NotificationsPage.tsx`
- Modify: `apps/web/src/components/Layout.tsx`（ベル追加）
- Modify: `apps/web/src/App.tsx`（`/notifications` ルート追加）
- Test: `apps/web/src/components/NotificationBell.test.tsx`, `apps/web/src/pages/NotificationsPage.test.tsx`

**Interfaces:**
- Consumes: Task 6 の API（hc 型推論。`api.api.notifications.$get` / `api.api.notifications['unread-count'].$get` / `api.api.notifications[':notificationId'].read.$post` / `api.api.notifications['read-all'].$post`）。
- Produces: `notificationMessage(n): string` と `NotificationItem` 型（web ローカル。JSON 経由なので日付は string）。キャッシュキー: `['notifications', 'unread-count']`（30 秒ポーリング）、`['notifications', 'recent']`（ベル開時のみ）、`['notifications', 'list']`（一覧ページ）。既読化・全既読後は `['notifications']` プレフィックスを invalidate。

- [ ] **Step 1: 文言ヘルパーを書く**

`apps/web/src/lib/notification-message.ts`:

```ts
export type NotificationItem = {
  id: string;
  type: 'comment' | 'reply' | 'reaction' | 'mention';
  actorId: string;
  actorName: string;
  articleId: string;
  articleTitle: string;
  commentId: string | null;
  readAt: string | null;
  createdAt: string;
};

export function notificationMessage(n: Pick<NotificationItem, 'type' | 'actorName' | 'articleTitle'>): string {
  switch (n.type) {
    case 'comment':
      return `${n.actorName}さんが「${n.articleTitle}」にコメントしました`;
    case 'reply':
      return `${n.actorName}さんがあなたのコメントに返信しました（${n.articleTitle}）`;
    case 'reaction':
      return `${n.actorName}さんが「${n.articleTitle}」にリアクションしました`;
    case 'mention':
      return `${n.actorName}さんが「${n.articleTitle}」であなたをメンションしました`;
  }
}
```

- [ ] **Step 2: NotificationBell の失敗するテストを書く**

`apps/web/src/components/NotificationBell.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getList = vi.fn();
const getUnread = vi.fn();
const postRead = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      notifications: {
        $get: (...args: unknown[]) => getList(...args),
        'unread-count': { $get: (...args: unknown[]) => getUnread(...args) },
        'read-all': { $post: vi.fn() },
        ':notificationId': { read: { $post: (...args: unknown[]) => postRead(...args) } },
      },
    },
  },
}));

import { NotificationBell } from './NotificationBell';

const item = {
  id: 'n1', type: 'comment', actorId: 'u2', actorName: '花子',
  articleId: 'a1', articleTitle: 'テスト記事', commentId: 'c1',
  readAt: null, createdAt: '2026-07-07T00:00:00.000Z',
};

function renderBell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationBell', () => {
  beforeEach(() => {
    getList.mockReset();
    getUnread.mockReset();
    postRead.mockReset();
  });

  it('未読数バッジを表示する', async () => {
    getUnread.mockResolvedValue({ ok: true, json: async () => ({ count: 3 }) });
    renderBell();
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('未読 0 ならバッジを出さない', async () => {
    getUnread.mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) });
    renderBell();
    expect(await screen.findByRole('button', { name: '通知' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('開くと直近の通知が表示され、クリックで既読 API が呼ばれる', async () => {
    getUnread.mockResolvedValue({ ok: true, json: async () => ({ count: 1 }) });
    getList.mockResolvedValue({ ok: true, json: async () => ({ items: [item], nextCursor: null }) });
    postRead.mockResolvedValue({ ok: true, status: 204 });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: '通知' }));
    const entry = await screen.findByText('花子さんが「テスト記事」にコメントしました');
    await userEvent.click(entry);
    expect(postRead).toHaveBeenCalledWith({ param: { notificationId: 'n1' } });
  });
});
```

- [ ] **Step 3: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/web test -- NotificationBell`
Expected: FAIL（コンポーネント未実装）

- [ ] **Step 4: NotificationBell を実装**

`apps/web/src/components/NotificationBell.tsx`:

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '../api/client';
import { notificationMessage, type NotificationItem } from '../lib/notification-message';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const res = await api.api.notifications['unread-count'].$get();
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: recent } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: async () => {
      const res = await api.api.notifications.$get({ query: { limit: '5' } });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    enabled: open,
  });

  async function openNotification(n: NotificationItem) {
    setOpen(false);
    if (!n.readAt) {
      await api.api.notifications[':notificationId'].read.$post({ param: { notificationId: n.id } });
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
    navigate(`/articles/${n.articleId}`);
  }

  const count = unread?.count ?? 0;
  const items = (recent?.items ?? []) as NotificationItem[];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="通知" className="relative">
          <Bell className="size-4" />
          {count > 0 && (
            <span
              aria-label={`未読 ${count} 件`}
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
            >
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        {items.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">通知はありません</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  className={`w-full rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted ${n.readAt ? 'text-muted-foreground' : 'font-medium'}`}
                >
                  {notificationMessage(n)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 border-t pt-1">
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-md px-2 py-1.5 text-center text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            すべて見る
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: NotificationBell テスト成功を確認**

Run: `pnpm --filter @knowledge-hub/web test -- NotificationBell`
Expected: 3/3 PASS

- [ ] **Step 6: NotificationsPage の失敗するテストを書く**

`apps/web/src/pages/NotificationsPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getList = vi.fn();
const postReadAll = vi.fn();
const postRead = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      notifications: {
        $get: (...args: unknown[]) => getList(...args),
        'unread-count': { $get: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) }) },
        'read-all': { $post: (...args: unknown[]) => postReadAll(...args) },
        ':notificationId': { read: { $post: (...args: unknown[]) => postRead(...args) } },
      },
    },
  },
}));

import { NotificationsPage } from './NotificationsPage';

const items = [
  {
    id: 'n1', type: 'mention', actorId: 'u2', actorName: '花子',
    articleId: 'a1', articleTitle: '記事A', commentId: null,
    readAt: null, createdAt: '2026-07-07T00:00:00.000Z',
  },
  {
    id: 'n2', type: 'reaction', actorId: 'u3', actorName: '次郎',
    articleId: 'a2', articleTitle: '記事B', commentId: null,
    readAt: '2026-07-06T00:00:00.000Z', createdAt: '2026-07-06T00:00:00.000Z',
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    getList.mockReset();
    postReadAll.mockReset();
    postRead.mockReset();
  });

  it('通知を一覧表示する', async () => {
    getList.mockResolvedValue({ ok: true, json: async () => ({ items, nextCursor: null }) });
    renderPage();
    expect(await screen.findByText('花子さんが「記事A」であなたをメンションしました')).toBeInTheDocument();
    expect(screen.getByText('次郎さんが「記事B」にリアクションしました')).toBeInTheDocument();
  });

  it('空のときは EmptyState を表示する', async () => {
    getList.mockResolvedValue({ ok: true, json: async () => ({ items: [], nextCursor: null }) });
    renderPage();
    expect(await screen.findByText('通知はまだありません')).toBeInTheDocument();
  });

  it('「すべて既読にする」で read-all API が呼ばれる', async () => {
    getList.mockResolvedValue({ ok: true, json: async () => ({ items, nextCursor: null }) });
    postReadAll.mockResolvedValue({ ok: true, status: 204 });
    renderPage();
    await screen.findByText('花子さんが「記事A」であなたをメンションしました');
    await userEvent.click(screen.getByRole('button', { name: 'すべて既読にする' }));
    expect(postReadAll).toHaveBeenCalled();
  });

  it('未読通知のクリックで既読 API が呼ばれる', async () => {
    getList.mockResolvedValue({ ok: true, json: async () => ({ items, nextCursor: null }) });
    postRead.mockResolvedValue({ ok: true, status: 204 });
    renderPage();
    await userEvent.click(await screen.findByText('花子さんが「記事A」であなたをメンションしました'));
    expect(postRead).toHaveBeenCalledWith({ param: { notificationId: 'n1' } });
  });
});
```

- [ ] **Step 7: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/web test -- NotificationsPage`
Expected: FAIL

- [ ] **Step 8: NotificationsPage を実装**

`apps/web/src/pages/NotificationsPage.tsx`:

```tsx
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { notificationMessage, type NotificationItem } from '../lib/notification-message';
import { Button } from '@/components/ui/button';
import { EmptyState } from '../components/EmptyState';
import { Loading } from '../components/Loading';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const query = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await api.api.notifications.$get({
        query: { ...(pageParam ? { cursor: pageParam } : {}) },
      });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = (query.data?.pages ?? []).flatMap((p) => p.items) as NotificationItem[];

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }

  async function openNotification(n: NotificationItem) {
    if (!n.readAt) {
      await api.api.notifications[':notificationId'].read.$post({ param: { notificationId: n.id } });
      await invalidate();
    }
    navigate(`/articles/${n.articleId}`);
  }

  async function readAll() {
    await api.api.notifications['read-all'].$post();
    await invalidate();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">通知</h1>
        {items.some((n) => !n.readAt) && (
          <Button type="button" variant="outline" size="sm" onClick={readAll}>
            すべて既読にする
          </Button>
        )}
      </div>

      {query.isLoading && <Loading />}
      {query.isError && <p className="text-destructive">通知の読み込みに失敗しました。</p>}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState message="通知はまだありません" />
      )}
      {items.length > 0 && (
        <ul className="flex flex-col divide-y">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => openNotification(n)}
                className={`flex w-full items-baseline justify-between gap-4 px-2 py-3 text-left text-sm transition-colors hover:bg-muted ${n.readAt ? 'text-muted-foreground' : 'font-medium'}`}
              >
                <span>{notificationMessage(n)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button type="button" variant="outline" className="self-center" onClick={() => query.fetchNextPage()}>
          もっと見る
        </Button>
      )}
    </div>
  );
}
```

注意: `EmptyState` の props は既存コンポーネントの実装（`message`）に合わせること。異なる場合は既存の呼び出し例（`CommentSection.tsx` の `<EmptyState message="まだコメントはありません" />`）に倣う。

- [ ] **Step 9: Layout と App にルートを配線**

`apps/web/src/components/Layout.tsx`: import に `NotificationBell` を追加し、`<ThemeToggle />` の直前に `<NotificationBell />` を置く:

```tsx
import { NotificationBell } from './NotificationBell';
// ...
            <span className="hidden px-2 text-muted-foreground sm:inline">{me?.displayName}</span>
            <NotificationBell />
            <ThemeToggle />
```

`apps/web/src/App.tsx`: import を追加し、children に:

```tsx
import { NotificationsPage } from './pages/NotificationsPage';
// ...
      { path: '/notifications', element: <NotificationsPage /> },
```

- [ ] **Step 10: テスト成功 + 全体確認**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 全 PASS

- [ ] **Step 11: コミット**

```bash
git add apps/web/src/lib/notification-message.ts apps/web/src/components/NotificationBell.tsx apps/web/src/components/NotificationBell.test.tsx apps/web/src/pages/NotificationsPage.tsx apps/web/src/pages/NotificationsPage.test.tsx apps/web/src/components/Layout.tsx apps/web/src/App.tsx
git commit -m "feat(web): add notification bell and notifications page"
```

---

### Task 8: Web — コメント欄の @ オートコンプリート

**Files:**
- Create: `apps/web/src/components/MentionTextarea.tsx`
- Modify: `apps/web/src/components/CommentSection.tsx`（CommentForm の Textarea を差し替え）
- Test: `apps/web/src/components/MentionTextarea.test.tsx`

**Interfaces:**
- Consumes: Task 6 の `GET /api/users`（`api.api.users.$get`）。shadcn `Textarea`。
- Produces: `<MentionTextarea value onChange aria-label rows? maxLength? autoFocus? />` — `onChange` は string を受ける（イベントではない）。挿入されるテキストは `[@表示名](/users/<id>) `（末尾スペース付き）。

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/components/MentionTextarea.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUsers = vi.fn();

vi.mock('../api/client', () => ({
  api: { api: { users: { $get: (...args: unknown[]) => getUsers(...args) } } },
}));

import { MentionTextarea } from './MentionTextarea';

const candidates = [
  { id: '47395b74-5d75-487d-9ee6-481eb4c32ebc', displayName: '田中', avatarUrl: null },
  { id: '11111111-2222-4333-8444-555555555555', displayName: '佐藤', avatarUrl: null },
];

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <MentionTextarea value={value} onChange={setValue} aria-label="コメント" />
      <output data-testid="current">{value}</output>
    </>
  );
}

function renderBox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe('MentionTextarea', () => {
  beforeEach(() => {
    getUsers.mockReset();
    getUsers.mockResolvedValue({ ok: true, json: async () => candidates });
  });

  it('@ を打つと候補が表示される', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('textbox', { name: 'コメント' }), 'こんにちは @');
    expect(await screen.findByRole('option', { name: '田中' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '佐藤' })).toBeInTheDocument();
  });

  it('@ の後の入力で候補が絞り込まれる', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('textbox', { name: 'コメント' }), '@田');
    expect(await screen.findByRole('option', { name: '田中' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '佐藤' })).not.toBeInTheDocument();
  });

  it('候補を選択するとリンク記法が挿入される', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('textbox', { name: 'コメント' }), '@田');
    await userEvent.click(await screen.findByRole('option', { name: '田中' }));
    expect(screen.getByTestId('current')).toHaveTextContent(
      '[@田中](/users/47395b74-5d75-487d-9ee6-481eb4c32ebc)',
    );
  });

  it('@ がなければ候補は出ない', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('textbox', { name: 'コメント' }), '普通のテキスト');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape で候補が閉じる', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('textbox', { name: 'コメント' }), '@');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/web test -- MentionTextarea`
Expected: FAIL（コンポーネント未実装）

- [ ] **Step 3: MentionTextarea を実装**

`apps/web/src/components/MentionTextarea.tsx`:

```tsx
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Textarea } from '@/components/ui/textarea';

type Candidate = { id: string; displayName: string; avatarUrl: string | null };

/** caret 直前の `@クエリ` トークンを探す（行頭または空白直後の @ のみ対象） */
function findMentionToken(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

export function MentionTextarea({
  value,
  onChange,
  'aria-label': ariaLabel,
  rows,
  maxLength,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  'aria-label': string;
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [token, setToken] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  const { data: candidates } = useQuery({
    queryKey: ['mention-candidates'],
    queryFn: async () => {
      const res = await api.api.users.$get();
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: token !== null,
  });

  const matches = useMemo(() => {
    if (!token || !candidates) return [];
    return (candidates as Candidate[])
      .filter((c) => c.displayName.toLowerCase().includes(token.query.toLowerCase()))
      .slice(0, 5);
  }, [token, candidates]);

  function syncToken() {
    const el = ref.current;
    if (!el) return;
    setToken(findMentionToken(el.value, el.selectionStart));
    setActive(0);
  }

  function insertMention(c: Candidate) {
    const el = ref.current;
    if (!el || !token) return;
    const caret = el.selectionStart;
    const inserted = `[@${c.displayName}](/users/${c.id}) `;
    onChange(value.slice(0, token.start) + inserted + value.slice(caret));
    setToken(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = token.start + inserted.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!token) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setToken(null);
      return;
    }
    if (matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(matches[active]);
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        aria-label={ariaLabel}
        value={value}
        rows={rows}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          syncToken();
        }}
        onKeyUp={syncToken}
        onClick={syncToken}
        onKeyDown={onKeyDown}
      />
      {token && matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="メンション候補"
          className="absolute z-10 mt-1 w-full max-w-xs rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                tabIndex={-1}
                className={`w-full rounded-sm px-2 py-1.5 text-left text-sm ${i === active ? 'bg-accent text-accent-foreground' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(c);
                }}
              >
                {c.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

注意: shadcn の `Textarea` が ref を受け取れること（forwardRef もしくは React 19 の ref prop）を確認。受け取れない実装なら `apps/web/src/components/ui/textarea.tsx` を確認して合わせる。`role="option"` は `li` に付け、`name` はボタンテキストから取れる構造にする（テストのクエリと一致させる）。テストが `getByRole('option', { name: ... })` で取れない場合は button 側に `role="option"` を移してよいが、listbox > option の階層は保つこと。

- [ ] **Step 4: テスト成功を確認**

Run: `pnpm --filter @knowledge-hub/web test -- MentionTextarea`
Expected: 5/5 PASS

- [ ] **Step 5: CommentForm に差し替え**

`apps/web/src/components/CommentSection.tsx`:
- import から `Textarea` を外し、`import { MentionTextarea } from './MentionTextarea';` を追加。
- `CommentForm` 内の `<Textarea ... />` を:

```tsx
      <MentionTextarea
        aria-label="コメント"
        value={value}
        onChange={setValue}
        rows={3}
        maxLength={5000}
        autoFocus={autoFocus}
      />
```

（`onChange` はイベントではなく string を受けるので `setValue` を直接渡す。）

- [ ] **Step 6: CommentSection の既存テスト回帰確認**

Run: `pnpm --filter @knowledge-hub/web test -- CommentSection`
Expected: 既存テスト全 PASS。CommentSection のテストが `api.api.users.$get` 未モックで落ちる場合は、mock の `api.api` に `users: { $get: vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) }` を追加する（候補クエリは `enabled: token !== null` なので通常は発火しないが、型/実行時安全のため）。

- [ ] **Step 7: 全体確認 + コミット**

Run: `pnpm --filter @knowledge-hub/web test && pnpm -r typecheck`
Expected: 全 PASS

```bash
git add apps/web/src/components/MentionTextarea.tsx apps/web/src/components/MentionTextarea.test.tsx apps/web/src/components/CommentSection.tsx
git commit -m "feat(web): add mention autocomplete to comment form"
```

---

## 最終確認（全タスク完了後）

- [ ] `docker compose up -d` の状態で `pnpm test`（全パッケージ）→ 全 PASS
- [ ] `pnpm typecheck`（全パッケージ）→ クリーン
- [ ] 最終レビュー観点（whole-branch review へ引き継ぐ）:
  - notifications への insert が notification-service 以外に存在しないこと（`grep -rn "insert(notifications)" apps/server/src` で確認）
  - 通知一覧・未読数の可視条件（published + 未削除）が一致していること
  - GET /api/users のレスポンスに email が含まれないこと
  - カーソルの ms 丸めが WHERE / ORDER BY で同一式を共有していること
  - 自己通知が全経路（comment / reply / reaction / mention × コメント・記事）で発生しないこと
  - 既存 API のレスポンス形状が変わっていないこと（web の hc 型推論に回帰がないこと）
