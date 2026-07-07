# Whole-Repo Review Fixes (Important I-1〜I-5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** リポジトリ全体レビュー（`scratchpad/whole-repo-review.md`, HEAD 4e28ab6）で挙がった Important 5 件を修正する。

**Architecture:** サーバー側は (1) UUID パラメータ検証の共通ヘルパー化 + FK 事前チェック、(2) article-service の楽観ロックのトランザクション化（FOR UPDATE）・listMine への date_trunc カーソルパターン適用・リビジョンの間引き。Web 側は (3) 公開ボタンでの未保存編集フラッシュ。

**Tech Stack:** Hono + Drizzle ORM + PostgreSQL（Testcontainers 実 DB テスト）、React 19 + Vitest + Testing Library。

## Global Constraints

- ブランチ: `fix/whole-repo-review-importants`（main 4e28ab6 から作成済み）
- エラーは必ず `AppError`（`apps/server/src/errors.ts`）で投げる。ユーザー入力起因で 500 を返してはならない
- エラーメッセージは日本語、既存文言のトーンに合わせる
- 既存の確立パターンを流用する: UUID 検証は `comments.ts:10-21` の形式、µs カーソルは `notification-service.ts` / `engagement-service.ts` の `date_trunc('milliseconds', ...)` パターン（WHERE と ORDER BY の両方に同じ丸めキー）
- サーバーテストは Testcontainers の実 PostgreSQL（`docker compose up -d` 前提）。モックで代替しない
- パスワード・トークンをログ・テスト出力に出さない
- コミットメッセージは英語 Conventional Commits（subject 小文字・50 字程度・末尾ピリオドなし）
- 通知は best-effort（`runNotify`）のまま。トランザクション内に通知を入れない

---

### Task 1: UUID パラメータ検証の共通化と FK 事前チェック（I-1）

Phase 2 系ルートは `c.req.param('id')` を無検証で DB に渡すため、malformed UUID で Postgres 22P02 → 500 になる。また実在しない `categoryId` / `reassignToId` は FK 違反 → 500 になる。

**Files:**
- Create: `apps/server/src/routes/guards.ts`
- Modify: `apps/server/src/routes/articles.ts`（`:id` を取る 9 エンドポイント全部）
- Modify: `apps/server/src/routes/categories.ts`（`/:id/articles`, `PATCH /:id`, `DELETE /:id`）
- Modify: `apps/server/src/routes/uploads.ts`（`GET /:id`）
- Modify: `apps/server/src/routes/admin.ts`（`PATCH /users/:id`）
- Modify: `apps/server/src/routes/comments.ts`, `apps/server/src/routes/engagement.ts`, `apps/server/src/routes/users.ts`（ローカル重複ヘルパーを guards.ts に置換。挙動は不変）
- Modify: `apps/server/src/services/article-service.ts`（categoryId 存在チェック）
- Modify: `apps/server/src/services/category-service.ts`（reassignToId 検証）
- Modify: `packages/shared/src/schemas/article.ts`（`categoryId` / `reassignToId` に `.uuid()` が無ければ追加。**先に現状を確認すること**）
- Test: `apps/server/src/routes/articles.test.ts`, `categories.test.ts`, `uploads.test.ts`, `admin.test.ts`（既存テストファイルに追記。無いものは既存ルートテストの流儀で作成）

**Interfaces:**
- Produces: `requireUuidParam(value: string, notFoundMessage: string): void` — malformed UUID なら `AppError('NOT_FOUND', notFoundMessage, 404)` を throw
- Produces: `article-service` 内 `assertCategoryExists(db: Db, categoryId: string): Promise<void>` — 不在なら `AppError('VALIDATION', '指定されたカテゴリが存在しません', 400)`（Task 2 の updateArticle 書き換え後も呼び出しを維持する）

**注意（設計判断・変更禁止）:** ミドルウェア（`.use('/:id', ...)`）方式は採らない。articles ルートには `/mine` `/pickup` という静的パスがあり、`use('/:id')` はそれらにもマッチして `:id = "mine"` で誤 404 させるため。既存フェーズ 3 と同じ「ハンドラ先頭で明示呼び出し」方式で統一する。

- [ ] **Step 1: 失敗するテストを書く**

各既存ルートテストファイルに追記（認証済みユーザーでリクエストする既存ヘルパーを流用）:

```ts
// articles.test.ts
it('GET /api/articles/:id は malformed UUID で 404 を返す', async () => {
  const res = await get('/api/articles/not-a-uuid'); // 既存の認証付きリクエストヘルパーに合わせる
  expect(res.status).toBe(404);
});
it('PATCH /api/articles/:id は malformed UUID で 404 を返す', async () => { /* 同型 */ });
it('POST /api/articles は実在しない categoryId で 400 を返す', async () => {
  const res = await post('/api/articles', { title: 't', bodyMd: 'b', tags: [], categoryId: crypto.randomUUID() });
  expect(res.status).toBe(400);
});
// categories.test.ts
it('DELETE /api/categories/:id は実在しない reassignToId で 400 を返す', async () => { /* 記事ありカテゴリ + ランダム UUID */ });
it('DELETE /api/categories/:id は reassignToId = 自分自身で 400 を返す', async () => { /* */ });
it('GET /api/categories/:id/articles は malformed UUID で 404 を返す', async () => { /* */ });
// uploads.test.ts
it('GET /api/uploads/:id は malformed UUID で 404 を返す', async () => { /* */ });
// admin.test.ts
it('PATCH /api/admin/users/:id は malformed UUID で 404 を返す', async () => { /* admin セッションで */ });
```

publish/unpublish/restore/purge/pin/unpin/delete はループで malformed UUID → 404 をまとめて検証する 1 テストにしてよい。

- [ ] **Step 2: RED を確認**

Run: `pnpm --filter @knowledge-hub/server test -- routes`
Expected: 追加テストが FAIL（現状は 500 が返る）。**500 が返ること（=バグの実在）を確認してから進む**

- [ ] **Step 3: guards.ts を作成し、全ルートに適用**

```ts
// apps/server/src/routes/guards.ts
import { z } from 'zod';
import { AppError } from '../errors';

const uuid = z.string().uuid();

// 不正な UUID 形式は DB エラー（22P02 → 500）ではなく NOT_FOUND として扱う
export function requireUuidParam(value: string, notFoundMessage: string): void {
  if (!uuid.safeParse(value).success) {
    throw new AppError('NOT_FOUND', notFoundMessage, 404);
  }
}
```

articles.ts の各 `:id` ハンドラ先頭に `requireUuidParam(c.req.param('id'), '記事が見つかりません');` を追加（9 箇所）。categories.ts は `'カテゴリが見つかりません'`、uploads.ts は `'画像が見つかりません'`、admin.ts は `'ユーザーが見つかりません'`。comments.ts / engagement.ts / users.ts のローカル `requireValid*` 関数は guards.ts 呼び出しに置換（メッセージは現状のまま維持）。

- [ ] **Step 4: categoryId / reassignToId の事前チェック**

まず `packages/shared/src/schemas/article.ts` を確認し、`categoryId` と `categoryDeleteSchema.reassignToId` が `z.string().uuid()` でなければ `.uuid()` を追加（malformed 文字列が存在チェッククエリ自体を 22P02 にするのを防ぐため）。

article-service.ts に追加し、`createArticle` と `updateArticle` の冒頭で `input.categoryId` があれば呼ぶ:

```ts
async function assertCategoryExists(db: Db, categoryId: string): Promise<void> {
  const row = await db.query.categories.findFirst({
    where: eq(categories.id, categoryId), columns: { id: true },
  });
  if (!row) throw new AppError('VALIDATION', '指定されたカテゴリが存在しません', 400);
}
```

category-service.ts `deleteCategory` の `hasArticles && !reassignToId` チェックの後に追加:

```ts
if (reassignToId) {
  if (reassignToId === id) {
    throw new AppError('VALIDATION', '移行先に削除対象のカテゴリは指定できません', 400);
  }
  const target = await db.query.categories.findFirst({
    where: eq(categories.id, reassignToId), columns: { id: true },
  });
  if (!target) throw new AppError('VALIDATION', '移行先のカテゴリが存在しません', 400);
}
```

- [ ] **Step 5: GREEN を確認（全サーバーテスト）**

Run: `pnpm --filter @knowledge-hub/server test`
Expected: 追加分含め全 PASS。`pnpm --filter @knowledge-hub/shared test` と `pnpm -r typecheck` も PASS（schema を触った場合 web の型に影響しないことを確認）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(server): return 4xx for malformed uuid params and missing fk targets"
```

---

### Task 2: article-service の原子性・カーソル・リビジョン間引き（I-2, I-3, I-5）

**Files:**
- Modify: `apps/server/src/services/article-service.ts`（`updateArticle`, `listMine`, `snapshot`）
- Test: `apps/server/src/services/article-service.test.ts`（既存に追記）

**Interfaces:**
- Consumes: Task 1 の `assertCategoryExists`（updateArticle 書き換え時に呼び出しを維持）
- Produces: `updateArticle` のシグネチャ・戻り値は不変（route 変更なし）

**2a. updateArticle のトランザクション化（I-2）**

現状は「SELECT → JS 比較 → 無条件 UPDATE」の check-then-act で、同一 `expectedUpdatedAt` の並行 PATCH が両方成功する（lost update）。`SELECT ... FOR UPDATE` + トランザクションで直列化する（`auth-service.ts` / `user-service.updateUserByAdmin` と同じ確立パターン）。**条件付き UPDATE（`WHERE updated_at = $2`）方式は採らない** — DB の µs 精度とドライバの ms 精度の不一致で自分自身と不一致になる罠があるため。

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('同一 expectedUpdatedAt の並行更新は片方だけ成功する（楽観ロックの原子性）', async () => {
  const article = /* 既存ヘルパーで draft 記事を作成 */;
  const expected = article.updatedAt.toISOString();
  const input = (title: string) => ({ title, bodyMd: 'b', tags: [], expectedUpdatedAt: expected });
  const results = await Promise.allSettled([
    updateArticle(db, article.id, author, input('A')),
    updateArticle(db, article.id, author, input('B')),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const ng = results.filter((r) => r.status === 'rejected');
  expect(ok).toHaveLength(1);
  expect(ng).toHaveLength(1);
  expect((ng[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
});
```

- [ ] **Step 2: RED を確認**

Run: `pnpm --filter @knowledge-hub/server test -- article-service`
Expected: FAIL（現状は両方 fulfilled になる）。タイミング起因で稀に通る可能性があるため、FAIL しない場合は 2 回実行して確認する

- [ ] **Step 3: 実装**

```ts
export async function updateArticle(
  db: Db,
  id: string,
  editor: SessionUser,
  input: ArticleInput & { expectedUpdatedAt: string },
): Promise<ArticleRecord> {
  if (input.categoryId) await assertCategoryExists(db, input.categoryId);
  const row = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(articles)
      .where(and(eq(articles.id, id), isNull(articles.deletedAt)))
      .for('update');
    if (!current) throw new AppError('NOT_FOUND', '記事が見つかりません', 404);
    if (!can(editor, 'article:edit', { authorId: current.authorId })) {
      throw new AppError('FORBIDDEN', 'この記事を編集する権限がありません', 403);
    }
    if (current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new AppError('CONFLICT', '別の場所で更新されています。読み込み直してください', 409);
    }
    if (current.status === 'published' && !input.categoryId) {
      throw new AppError('VALIDATION', '公開記事にはカテゴリの指定が必要です', 400);
    }
    const searchText = buildSearchText({ title: input.title, bodyMd: input.bodyMd, tags: input.tags });
    const [updated] = await tx
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
    await setArticleTags(tx, id, input.tags);
    await snapshot(tx, updated);
    return updated;
  });
  // 通知は best-effort のままトランザクションの外（Global Constraints）
  if (row.status === 'published') {
    await runNotify('article-mentions-update', () => notifyArticleMentions(db, row));
  }
  return row;
}
```

`setArticleTags` / `snapshot` の第 1 引数型が tx を受けられない場合は、`Db` を `NodePgDatabase<typeof schema> | Parameters<Parameters<Db['transaction']>[0]>[0]` にするのではなく、既存の `types.ts` の `Db` 型定義を確認して tx 互換の最小修正にとどめる（category-service など既存トランザクション利用箇所の型の扱いに合わせる）。

- [ ] **Step 4: GREEN を確認 → Commit**

Run: `pnpm --filter @knowledge-hub/server test -- article-service`

```bash
git add -A
git commit -m "fix(server): make article optimistic lock atomic with row lock"
```

**2b. listMine への date_trunc パターン適用（I-3）**

- [ ] **Step 5: 失敗するテストを書く（µs 注入回帰テスト）**

`engagement-service.test.ts:166` 付近の既存 µs 注入テストと同型。同一 ms バケット内に µs 差のある 2 行を SQL で作り、id 順序を反転させ、limit=1 でページングして全行が現れることを検証:

```ts
it('listMine は同一ミリ秒の下書きをページ境界で取りこぼさない', async () => {
  // 2 記事を作成後、SQL で updated_at を同一 ms・異なる µs に固定
  // （id の大小と µs の大小を逆転させる。engagement-service.test.ts の手法を流用）
  await db.execute(sql`update articles set updated_at = '2026-01-01 00:00:00.123456+00' where id = ${idSmall}`);
  await db.execute(sql`update articles set updated_at = '2026-01-01 00:00:00.123789+00' where id = ${idBig}`);
  const page1 = await listMine(db, authorId, 'draft', { limit: 1 });
  const page2 = await listMine(db, authorId, 'draft', { cursor: page1.nextCursor!, limit: 1 });
  const seen = [...page1.items, ...page2.items].map((a) => a.id);
  expect(new Set(seen).size).toBe(2); // 現状は同一 ms バケットの行が欠落して FAIL する
});
```

- [ ] **Step 6: RED を確認**（欠落 or 重複で FAIL することを確認）

- [ ] **Step 7: 実装**

`listMine` の WHERE / ORDER BY / encodeCursor を丸めキーに統一（notification-service の desc パターンを流用）:

```ts
const updatedAtMs = sql`date_trunc('milliseconds', ${articles.updatedAt})`;
// cursor WHERE:
or(
  sql`${updatedAtMs} < ${new Date(c.sortKey)}`,
  and(sql`${updatedAtMs} = ${new Date(c.sortKey)}`, lt(articles.id, c.id)),
)
// ORDER BY:
.orderBy(desc(updatedAtMs), desc(articles.id))
```

理由コメント（comment-service.ts:122-128 と同趣旨）を必ず付ける。

- [ ] **Step 8: GREEN → Commit**

```bash
git commit -am "fix(server): apply ms-truncated cursor keyset to listMine"
```

**2c. リビジョンの間引き（I-5）**

現状: 2 秒デバウンス保存のたびに全文スナップショットを無条件 INSERT（上限・間引きなし）。方針: (1) 直近リビジョンと同一内容ならスキップ、(2) 直近リビジョンが 10 分以内なら in-place 更新、(3) それ以外は INSERT。編集 1 時間あたり最大 6 リビジョンに抑制される。

- [ ] **Step 9: 失敗するテストを書く**

```ts
it('同一内容の保存はリビジョンを増やさない', async () => { /* update を同一 title/body で 2 回 → revisions 1 件 */ });
it('10 分以内の連続保存は直近リビジョンを上書きする', async () => {
  // update 2 回（内容変更あり）→ revisions は 1 件で、内容は 2 回目のもの
});
it('10 分より古い直近リビジョンがある場合は新規リビジョンを作る', async () => {
  // 1 回目の update 後、SQL で saved_at を 11 分前に更新 → 2 回目の update → revisions 2 件
});
```

件数確認は `db.select().from(articleRevisions).where(eq(articleRevisions.articleId, id))` で直接行う（`listRevisions` はルート未配線のため使わなくてよいが、使っても可）。

- [ ] **Step 10: RED を確認**（現状は毎回 INSERT されるので件数超過で FAIL）

- [ ] **Step 11: 実装**

```ts
// 自動保存（2 秒デバウンス）のたびに全文スナップショットを積むとテーブルが際限なく
// 膨張するため、(1) 同一内容はスキップ、(2) 直近 10 分以内は in-place 上書き、で間引く。
const REVISION_COLLAPSE_MS = 10 * 60 * 1000;

async function snapshot(db: Db, article: { id: string; title: string; bodyMd: string }) {
  const [latest] = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.articleId, article.id))
    .orderBy(desc(articleRevisions.savedAt))
    .limit(1);
  if (latest && latest.title === article.title && latest.bodyMd === article.bodyMd) return;
  if (latest && Date.now() - latest.savedAt.getTime() < REVISION_COLLAPSE_MS) {
    await db
      .update(articleRevisions)
      .set({ title: article.title, bodyMd: article.bodyMd, savedAt: new Date() })
      .where(eq(articleRevisions.id, latest.id));
    return;
  }
  await db.insert(articleRevisions).values({
    articleId: article.id, title: article.title, bodyMd: article.bodyMd,
  });
}
```

- [ ] **Step 12: GREEN（サーバー全テスト）→ Commit**

Run: `pnpm --filter @knowledge-hub/server test`

```bash
git commit -am "fix(server): throttle article revision snapshots"
```

---

### Task 3: 公開ボタンで未保存編集をフラッシュ（I-4）

`EditorPage.tsx` の `publish()` は `const target = id ?? (await enqueueSave());` のため、既に `id` がある記事では保存せずに publish する。直近 2 秒以内の編集は公開版に含まれず、`navigate()` によるアンマウントでデバウンスタイマーも消えるため永久に失われる。

**Files:**
- Modify: `apps/web/src/pages/EditorPage.tsx:148-159`
- Test: `apps/web/src/pages/EditorPage.test.tsx`（既存に追記。既存テストのモック方式を踏襲）

**Interfaces:**
- Consumes: 既存の `enqueueSave(): Promise<string | null>`（save 直列化チェーン。変更しない）

- [ ] **Step 1: 失敗するテストを書く**

既存 EditorPage.test.tsx のモック手法（fetch/api モック）を確認し、それに合わせて:

```tsx
it('公開時は id が既にあっても保存を実行してから publish する', async () => {
  // 既存記事の編集画面を描画 → 本文を変更 →（デバウンス発火前に）公開ボタンをクリック
  // 記録されたリクエスト列に PATCH /api/articles/:id が publish POST より前に含まれることを検証
});
```

- [ ] **Step 2: RED を確認**

Run: `pnpm --filter @knowledge-hub/web test -- EditorPage`
Expected: FAIL（PATCH が発行されず publish のみが飛ぶ）

- [ ] **Step 3: 実装**

```tsx
async function publish() {
  // id の有無に関わらず必ず保存をフラッシュしてから publish する。
  // （id ありをスキップすると、デバウンス発火前の直近編集が公開版に含まれず、
  //   navigate によるアンマウントで保存もされず失われる）
  let target: string | null = null;
  try {
    target = await enqueueSave();
  } catch {
    setError('保存に失敗しました');
    return;
  }
  if (!target) return;
  const res = await api.api.articles[':id'].publish.$post({ param: { id: target } });
  // 以下は現状のまま
}
```

注意: `enqueueSave()` の reject 経路は `saveChain` 側で握り潰される設計（`next.catch(() => null)` はチェーン用で、返す `next` 自体は reject しうる）。try/catch を必ず付ける。

- [ ] **Step 4: GREEN を確認（web 全テスト）**

Run: `pnpm --filter @knowledge-hub/web test`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(web): flush pending editor changes before publish"
```

---

## 完了条件

- 全タスク完了後、最終レビュー（whole-branch）→ ルートで `pnpm run verify` が exit 0
