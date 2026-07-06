# Phase 3a: 全文検索 + プロフィール 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pg_bigm による日本語全文検索（スニペット付き、カテゴリ・タグ・著者絞り込み）と、著者プロフィールページ（アイコンアップロード含む）を実装する。

**Architecture:** 検索は既存の `articles.search_text`（2a から全記事で維持済み。タイトル + 本文平文 + タグ）に対する `LIKE '%q%'` で実装し、`lower(search_text)` の GIN 式インデックス（`gin_bigm_ops`）で加速する。**インデックスは結果の意味を変えない**ため、pg_bigm が無い環境（テスト用 postgres:16-alpine）でも同一の検索結果が返る — migration は extension 不在でも失敗させず、本番起動時に extension 欠如を警告する。検索は §9 の RAG 差し込み点である `SearchService` インターフェース背後に実装する。プロフィールは既存の `users.avatar_url` カラム（Phase 1 から存在・未使用）と既存の `listByAuthor`（2a のデッドコード・公開記事のみ）を活かす。

**Tech Stack:** pg_bigm 1.2（docker/db イメージに組込み済み・init.sql で extension 作成済み）、drizzle カスタムマイグレーション、既存スタック（Hono / Drizzle / React / TanStack Query / shadcn）

**Spec:** `docs/superpowers/specs/2026-07-04-knowledge-hub-design.md` §2（スコープ）・§8（機能設計: 検索・プロフィール）・§9（SearchService = RAG 差し込み点）

## Global Constraints

- **検索対象は公開・未削除記事のみ**（`status = 'published'` かつ `deleted_at IS NULL`。下書き・ゴミ箱の内容は決して返さない）。著者別記事一覧（プロフィール）も同じ制約。
- **LIKE メタ文字（`%` `_` `\`）は必ずエスケープ**してから検索パターンに埋め込む。
- **pg_bigm はオプショナルな加速**: migration は extension 不在でもエラーにしない（Testcontainers は postgres:16-alpine）。検索 SQL は素の `LIKE` で、インデックスの有無で結果が変わらないこと。本番での欠如はサーバー起動時の警告ログで気付けるようにする。
- **`search_text` の内容・格納形式は変更しない**（フィード excerpt が `left(search_text, 160)` を表示に使っているため）。大文字小文字を無視した検索は `lower()` の式インデックスとクエリ側の `lower()` で実現する。
- **avatarUrl は `/api/uploads/<uuid>` 形式のみ許可**（外部 URL は保存させない）。
- API は統一エラー形式 `{ code, message, details? }`。既存テスト（web 56 / server 113）は無修正で green を維持する。
- 色はデザイントークンのみ（生の色コード直書き禁止。例外: `components/ui/` 生成物）。
- 各タスク完了時に `pnpm --filter @knowledge-hub/web test` と `pnpm --filter @knowledge-hub/web typecheck` が green（server を触るタスクは `pnpm --filter @knowledge-hub/server test` と `typecheck` も。Docker 起動が前提）。

## 非スコープ（このフェーズでやらない）

- 検索結果の関連度順ソート（時系列降順のみ。pg_bigm の類似度ソートは将来）
- 著者絞り込みの専用 UI（API は `authorId` を受けるが、UI は URL パラメータでのみ到達可能）
- ヘッダーへの自分のアバター表示（プロフィール・設定画面のみ）
- メンション用のユーザー検索 API（Phase 3c）
- コメント・リアクション・ブックマーク・通知（Phase 3b/3c）

## File Structure

```
apps/server/
  drizzle/0002_search_bigm_index.sql      # 新規: GIN 式インデックス（DO ブロックで安全に）
  src/index.ts                             # 変更: pg_bigm 欠如の起動時警告
  src/services/search-service.ts           # 新規: SearchService インターフェース + bigm 実装
  src/services/search-service.test.ts      # 新規
  src/services/user-service.ts             # 変更: getPublicProfile + avatarUrl 対応
  src/routes/search.ts                     # 新規: GET /api/search
  src/routes/users.ts                      # 変更: GET /:id, GET /:id/articles
  src/app.ts                               # 変更: search dep + ルート配線
packages/shared/src/schemas/
  article.ts                               # 変更: searchQuerySchema 追加
  auth.ts                                  # 変更: updateProfileSchema に avatarUrl
apps/web/src/
  pages/SearchPage.tsx                     # 新規
  pages/ProfilePage.tsx                    # 新規
  pages/SettingsPage.tsx                   # 変更: アバターアップロード
  components/Layout.tsx                    # 変更: ヘッダー検索ボックス
  components/ArticleCard.tsx               # 変更: 著者名を /users/:id リンク化
  pages/ArticleDetailPage.tsx              # 変更: 同上
  App.tsx                                  # 変更: /search, /users/:id ルート
```

## モデル・スキル指定

- Task 3（SearchService）はカーソル・スニペット・絞り込みの組み合わせで判断を要するため標準以上のモデルを推奨。他は既存パターンの転写が中心。
- UI は 2b-1 のデザインシステム（トークン + 確立済みパターン）を踏襲。新たなデザイン創作は不要（frontend-design 不要）。

---

### Task 1: 検索インデックスのマイグレーション + 起動時警告

**Files:**
- Create: `apps/server/drizzle/0002_search_bigm_index.sql`（`drizzle-kit generate --custom` で生成して編集）
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Produces: `articles_search_text_bigm_idx`（`lower(search_text)` の GIN 式インデックス。Task 3 のクエリ形 `lower(search_text) LIKE lower(?)` がこれに乗る）

- [ ] **Step 1: カスタムマイグレーションを生成**

```bash
pnpm --filter @knowledge-hub/server exec drizzle-kit generate --custom --name=search_bigm_index
```

生成された空の SQL ファイル（`drizzle/0002_search_bigm_index.sql`）を以下の内容にする:

```sql
-- pg_bigm による日本語部分一致検索の GIN 式インデックス。
-- インデックスは LIKE の結果を変えず加速するだけなので、pg_bigm が無い環境
-- （テスト用 postgres:16-alpine 等）では作成をスキップして migration を成功させる。
-- 本番での extension 欠如はサーバー起動時の警告ログで検知する（src/index.ts）。
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_bigm;
  CREATE INDEX IF NOT EXISTS articles_search_text_bigm_idx
    ON articles USING gin (lower(search_text) gin_bigm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_bigm unavailable, skipping search index: %', SQLERRM;
END $$;
```

- [ ] **Step 2: alpine（extension 無し）でも migration が通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test`
Expected: 全 114 テスト green（global-setup が postgres:16-alpine 上でこの migration を適用する。DO ブロックが失敗すると全テストが落ちるので、これ自体が回帰テストになる）

- [ ] **Step 3: 本番向けの起動時警告を追加**

`src/index.ts` を読み、DB プール作成後・サーバー listen 前に以下の趣旨のチェックを追加する（既存のロガーを使う。関数化するかインラインかは既存コードの形に合わせる）:

```ts
// 検索は pg_bigm が無くても LIKE で動くが遅くなるため、欠如を運用者に知らせる
const bigm = await pool.query(`select 1 from pg_extension where extname = 'pg_bigm'`);
if (bigm.rowCount === 0) {
  logger.warn('pg_bigm extension not installed: search runs without index acceleration');
}
```

- [ ] **Step 4: 実 DB（compose の pg_bigm 入りイメージ）でインデックスが作られることを確認**

Run: `pnpm --filter @knowledge-hub/server db:migrate` then
`docker compose exec db psql -U khub -d khub -c "\di articles_search_text_bigm_idx"`
Expected: インデックスが 1 件表示される

- [ ] **Step 5: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`

```bash
git add apps/server
git commit -m "feat(server): add bigm search index with graceful degradation"
```

---

### Task 2: shared スキーマ（検索クエリ + avatarUrl）

**Files:**
- Modify: `packages/shared/src/schemas/article.ts`
- Modify: `packages/shared/src/schemas/auth.ts`
- Modify: `packages/shared/src/schemas/article.test.ts`（追記）

**Interfaces:**
- Produces: `searchQuerySchema`（Task 3/4 が使用）、`updateProfileSchema` の `avatarUrl`（Task 5 が使用）

- [ ] **Step 1: searchQuerySchema を追加（article.ts）**

```ts
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  categoryId: z.string().uuid().optional(),
  tag: tagNameSchema.optional(),
  authorId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
```

- [ ] **Step 2: updateProfileSchema に avatarUrl を追加（auth.ts）**

```ts
export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50),
  bio: z.string().max(2000),
  // アプリ内アップロード URL のみ許可（外部 URL は保存させない）。null で削除、未指定なら変更しない
  avatarUrl: z
    .string()
    .regex(/^\/api\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    .nullable()
    .optional(),
});
```

- [ ] **Step 3: スキーマテストを追記**

article.test.ts に: `searchQuerySchema` が (1) q 空文字を拒否 (2) q 101 文字を拒否 (3) 最小入力 `{ q: '検索' }` を通し limit=20 が既定になる、の 3 ケース。auth 側のテストファイルが既にあればそこに、無ければ article.test.ts と同じ流儀で: `updateProfileSchema` が (1) `avatarUrl: '/api/uploads/<有効UUID>'` を通す (2) 外部 URL `https://evil.example/x.png` を拒否 (3) `avatarUrl: null` を通す、の 3 ケース。

- [ ] **Step 4: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/shared test && pnpm typecheck`
Expected: shared のテスト green、全パッケージ typecheck クリーン（server の updateProfile が新フィールドで型エラーになる場合は Task 5 で対応するため、このタスクでは optional 追加のみで型が通ることを確認する）

```bash
git add packages/shared
git commit -m "feat(shared): add search query schema and avatar url to profile"
```

---

### Task 3: SearchService（TDD）

**Files:**
- Create: `apps/server/src/services/search-service.ts`
- Create: `apps/server/src/services/search-service.test.ts`

**Interfaces:**
- Consumes: `searchQuerySchema` の型（Task 2）、既存 `articles` / `articleTags` / `tags` / `categories` / `users` スキーマ
- Produces: `SearchService` インターフェースと `createBigmSearchService(): SearchService`、`SearchResultItem` 型（Task 4 が使用）

**設計指針:**
- 実装は既存 `article-service.ts` の `pagePublished` のカーソル・ページング流儀（`publishedAt` 降順 + `id` 降順、`nextCursor`）を踏襲する。ただし excerpt ではなく**スニペット**（最初のヒット位置の前後を切り出し）を返すため、`pagePublished` は再利用せず search-service 内に自前のクエリを持つ。既存コードを読んで idiom を合わせること。
- §9 のとおり、route からは `SearchService` インターフェースのみに依存させる（将来 RAG 実装を差し込む点）。

- [ ] **Step 1: 失敗するテストを書く**

`search-service.test.ts`。既存のサービステスト（`article-service.test.ts` 等）と同じ Testcontainers セットアップ流儀で。カバーするケース:

1. タイトルのみにヒットする語で検索 → 該当記事が返る
2. 本文のみにヒットする語で検索 → 返る
3. タグのみにヒットする語で検索 → 返る（search_text にタグが入っている前提）
4. **下書き記事・ゴミ箱記事はヒットしない**（同じ語を含んでいても）
5. `%` を含むクエリがリテラルとして扱われる（`100%` を含む記事だけがヒットし、全件マッチしない）
6. `categoryId` 絞り込み: 親カテゴリ指定で**子カテゴリの記事も**返る（カテゴリページと同じ意味論）
7. `tag` 絞り込み: 指定タグを持つ記事のみ
8. `authorId` 絞り込み: 指定著者のみ
9. スニペット: 本文後方でヒットした場合、snippet にクエリ語が含まれる（`left(…,160)` に入らない位置でも）
10. カーソルページング: limit=1 で 2 ページ目が取れ、重複しない
11. 大文字小文字: `TypeScript` を `typescript` で検索してもヒットする

- [ ] **Step 2: FAIL を確認**

Run: `pnpm --filter @knowledge-hub/server test -- src/services/search-service.test.ts`
Expected: FAIL（search-service.ts が存在しない）

- [ ] **Step 3: 実装**

```ts
import { and, desc, eq, exists, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { articles, articleTags, categories, tags, users } from '../db/schema';
import type { Db } from '../types';

export type SearchResultItem = {
  id: string;
  title: string;
  snippet: string;
  authorId: string;
  authorName: string;
  categoryId: string | null;
  publishedAt: string | null;
  updatedAt: string;
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
        eq(articles.status, 'published'),
        isNull(articles.deletedAt),
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
      // …（article-service.ts の pagePublished を読んで同じ形式の cursor encode/decode を実装）
      // スニペット: 最初のヒット位置の前後を切り出す。ヒットが先頭 40 文字以内なら先頭から
      const snippet = sql<string>`
        case
          when strpos(lower(${articles.searchText}), ${qLower}) > 40
          then '…' || substring(${articles.searchText} from strpos(lower(${articles.searchText}), ${qLower}) - 40 for 160)
          else left(${articles.searchText}, 160)
        end`;
      // select: id, title, snippet, authorId, authorName(users join), categoryId, publishedAt, updatedAt
      // order by publishedAt desc, id desc / limit+1 で nextCursor 判定
      // …実装
    },
  };
}
```

カーソルの encode/decode・limit+1 での次ページ判定・users join は `pagePublished` の実装を読んで**同じ形式**で実装する（フォーマットを変えると将来の統合が面倒になる）。

- [ ] **Step 4: PASS を確認**

Run: `pnpm --filter @knowledge-hub/server test -- src/services/search-service.test.ts`
Expected: 全 11 ケース PASS

- [ ] **Step 5: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`

```bash
git add apps/server
git commit -m "feat(server): add bigm-backed search service behind interface"
```

---

### Task 4: GET /api/search ルート

**Files:**
- Create: `apps/server/src/routes/search.ts`
- Create: `apps/server/src/routes/search.test.ts`
- Modify: `apps/server/src/app.ts`（deps に `search: SearchService` 追加 + `/api/search` 配線）
- Modify: `apps/server/src/index.ts`（`createBigmSearchService()` を渡す）
- Modify: `apps/server/src/types.ts`（AppEnv の Variables に `search` があれば追加。既存の `db`/`storage` の渡し方に合わせる）

**Interfaces:**
- Consumes: Task 2 の `searchQuerySchema`、Task 3 の `SearchService`
- Produces: `GET /api/search?q=&categoryId=&tag=&authorId=&cursor=&limit=` → `{ items: SearchResultItem[], nextCursor }` （Task 6 が hc 経由で使用）

- [ ] **Step 1: ルートを実装**

```ts
import { Hono } from 'hono';
import { searchQuerySchema } from '@knowledge-hub/shared';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import type { AppEnv } from '../types';

export const searchRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', validate('query', searchQuerySchema), async (c) =>
    c.json(await c.get('search').search(c.get('db'), c.req.valid('query'))),
  );
```

`app.ts` の deps・`c.set` は既存の `storage` と同じパターンで `search` を追加し、`.route('/api/search', searchRoutes)` を配線。`index.ts` で `search: createBigmSearchService()` を渡す。**既存テストが `buildApp` を deps 付きで呼んでいる場合、全テストヘルパに `search` を足す必要がある** — テストヘルパ（`buildApp` を呼んでいる箇所）を grep して一括で追従すること（既存テストの検証内容は変えない。deps 追加のみ）。

- [ ] **Step 2: ルートテストを書く**

(1) 未認証 → 401 (2) `q` なし → 400 (3) 認証済み + ヒットする記事で 200 と items 形状 — の 3 ケース（検索ロジック自体は Task 3 で網羅済み。ここは配線の検証）。

- [ ] **Step 3: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck && pnpm typecheck`
Expected: 既存テスト green（deps 追従込み）+ 新規 green

```bash
git add apps/server
git commit -m "feat(server): expose search endpoint"
```

---

### Task 5: プロフィール API（公開プロフィール・著者別記事・アバター更新）

**Files:**
- Modify: `apps/server/src/services/user-service.ts`（`getPublicProfile` 追加、`updateProfile` の avatarUrl 対応）
- Modify: `apps/server/src/routes/users.ts`（`GET /:id`、`GET /:id/articles`）
- Modify: `apps/server/src/services/user-service.test.ts` / `apps/server/src/routes/users.test.ts`（追記）

**Interfaces:**
- Consumes: Task 2 の `updateProfileSchema`（avatarUrl 追加済み）、既存 `listByAuthor`（article-service、公開記事のみ返すことを確認済み）
- Produces: `GET /api/users/:id` → `{ id, displayName, bio, avatarUrl }`、`GET /api/users/:id/articles` → 記事一覧 Page（Task 7 が使用）

- [ ] **Step 1: getPublicProfile（TDD）**

テスト: (1) 存在するユーザー → id/displayName/bio/avatarUrl のみ返す（**email・role・passwordHash を含まない**ことをアサート）(2) 不在 UUID → NOT_FOUND。実装:

```ts
export async function getPublicProfile(db: Db, id: string) {
  // 不正な UUID 形式は DB エラー（500）ではなく NOT_FOUND として扱う
  // （既知の課題: 2a の :id 系ルートは malformed UUID で 500 になる。ここでは踏襲しない）
  if (!z.string().uuid().safeParse(id).success) {
    throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);
  }
  const row = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true, displayName: true, bio: true, avatarUrl: true },
  });
  if (!row) throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);
  return row;
}
```

`GET /:id/articles` 側も同じく、ハンドラ冒頭で id の UUID 形式を検証して不正なら NOT_FOUND を返す（`listByAuthor` に渡す前に弾く）。

- [ ] **Step 2: updateProfile の avatarUrl 対応（TDD）**

テスト: (1) avatarUrl を設定できる (2) null で削除できる (3) 未指定なら既存値が変わらない。実装は既存 `updateProfile` に `...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {})` の形で追加（既存の displayName/bio の扱いは不変）。

- [ ] **Step 3: ルート追加**

```ts
  .get('/:id', async (c) => c.json(await getPublicProfile(c.get('db'), c.req.param('id'))))
  .get('/:id/articles', validate('query', listQuerySchema), async (c) =>
    c.json(await listByAuthor(c.get('db'), c.req.param('id'), c.req.valid('query'))),
  )
```

既存の `/me` 系ルート**より後**にチェーンする。ルートテスト: (1) `GET /users/:id` 200 (2) `GET /users/:id/articles` に**下書きが含まれない**（本人の下書きを作ってから他ユーザーで取得）(3) 不正な UUID 形式（例 `abc`）→ 404（上記の形式検証により 500 にならないこと）。

- [ ] **Step 4: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`

```bash
git add apps/server
git commit -m "feat(server): add public profile and author articles endpoints"
```

---

### Task 6: Web 検索（ヘッダー検索ボックス + 検索ページ）

**Files:**
- Create: `apps/web/src/pages/SearchPage.tsx`
- Modify: `apps/web/src/components/Layout.tsx`（ヘッダーに検索フォーム）
- Modify: `apps/web/src/App.tsx`（`/search` ルート）
- Create: `apps/web/src/pages/SearchPage.test.tsx`

**Interfaces:**
- Consumes: Task 4 の `GET /api/search`（hc 経由 `api.api.search.$get`）、既存 `CategorySelect`（id prop 対応済み）、`EmptyState` / `Loading` / `Input` / `Label`

- [ ] **Step 1: Layout に検索フォームを追加**

nav 内（「記事を書く」リンクの前）に:

```tsx
<form
  role="search"
  onSubmit={(e) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  }}
>
  <Input
    value={searchInput}
    onChange={(e) => setSearchInput(e.target.value)}
    placeholder="記事を検索"
    aria-label="記事を検索"
    className="h-8 w-36 lg:w-56"
  />
</form>
```

`useState` と `useNavigate` は既存 import に追加。既存のリンク・ログアウト・ThemeToggle は不変。

- [ ] **Step 2: SearchPage を実装**

- `useSearchParams` で `q` / `categoryId` / `tag` を読む（URL が状態の正。フォーム操作は `setSearchParams` で反映）。
- `useInfiniteQuery`（queryKey: `['search', q, categoryId, tag]`、`enabled: q.length > 0`）で `api.api.search.$get({ query: ... })`。
- 絞り込み UI: `CategorySelect`（`id="search-category"`、Label「カテゴリ」）+ タグ入力（プレーンな `Input`、`id="search-tag"`、Label「タグ」、Enter か blur で反映）。著者絞り込みの UI は作らない（URL パラメータ `authorId` はそのまま API に渡す）。
- 結果カード: タイトル（`/articles/:id` リンク）+ snippet（`text-sm text-muted-foreground`）+ 著者名。既存 ArticleCard は excerpt 前提なので**再利用せず**このページ内で簡素なカードを組む（`rounded-xl border bg-card p-5` の既存トーン踏襲）。
- `q` が空: 「キーワードを入力してください」の案内。結果 0 件: `EmptyState`（「『{q}』に一致する記事はありません」）。
- 「もっと見る」ボタンで fetchNextPage（既存一覧と同じ）。

- [ ] **Step 3: テスト**

既存ページテストの流儀（api クライアントをモック）で: (1) `/search?q=xxx` で search API が `q: 'xxx'` 付きで呼ばれ、結果タイトルが表示される (2) 0 件で EmptyState 文言 (3) q なしで案内文言（API 未呼び出し）。

- [ ] **Step 4: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 既存 56 テスト無修正 green + 新規 green

```bash
git add apps/web
git commit -m "feat(web): add search page with header search box"
```

---

### Task 7: Web プロフィールページ + 著者名リンク化

**Files:**
- Create: `apps/web/src/pages/ProfilePage.tsx`
- Create: `apps/web/src/pages/ProfilePage.test.tsx`
- Modify: `apps/web/src/components/ArticleCard.tsx`（著者名を Link に）
- Modify: `apps/web/src/pages/ArticleDetailPage.tsx`（著者名を Link に）
- Modify: `apps/web/src/App.tsx`（`/users/:id` ルート）

**Interfaces:**
- Consumes: Task 5 の `GET /api/users/:id` / `GET /api/users/:id/articles`、既存 `ArticleList` / `Loading` / `EmptyState`

- [ ] **Step 1: ProfilePage を実装**

- `useParams` の id で `useQuery(['user', id])` → プロフィール、`useInfiniteQuery(['user-articles', id])` → 記事一覧。
- ヘッダ部: アバター（`avatarUrl` があれば `<img className="size-16 rounded-full object-cover" alt="" />`、無ければ `displayName` 先頭 1 文字の丸プレート `size-16 rounded-full bg-muted text-xl font-semibold grid place-items-center`）+ `<h2>` displayName + bio（`whitespace-pre-wrap text-sm text-muted-foreground`。空なら非表示）。
- 「執筆記事」セクション: `ArticleList`（emptyText「公開記事はまだありません。」）。
- ロード中 `Loading`、404 は「ユーザーが見つかりません。」。

- [ ] **Step 2: 著者名リンク化（文言不変）**

ArticleCard の `{item.authorName}` と ArticleDetailPage の `{article.authorName}` を `<Link to={`/users/${authorId}`} className="hover:underline">` で包む。**表示文言・周辺構造は変えない**（既存テストの getByText が通ること）。

- [ ] **Step 3: テスト**

(1) プロフィール表示（displayName・bio が出る）(2) avatarUrl なしでイニシャルプレート表示 (3) 記事一覧が出る — の 3 ケース。

- [ ] **Step 4: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`

```bash
git add apps/web
git commit -m "feat(web): add author profile page and link author names"
```

---

### Task 8: 設定画面にアバターアップロード

**Files:**
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/pages/SettingsPage.test.tsx`（無ければ新規。既存テストがある場合は追記のみ）

**Interfaces:**
- Consumes: 既存 `uploadImage`（`@/lib/upload`）、Task 2/5 の avatarUrl 対応 PATCH `/api/users/me`

- [ ] **Step 1: プロフィールフォームにアバター欄を追加**

プロフィール Card 内・表示名の上に:

- 現在のアバター表示（ProfilePage と同じ表示ロジック: 画像 or イニシャルプレート、`size-16`）
- 「画像を選択」ボタン（`Button variant="outline" size="sm"` + 非表示 `<input type="file" accept="image/*" id="settings-avatar">`、Label「アイコン」htmlFor 対応）→ 選択で `uploadImage(file)` → 成功したら state の avatarUrl を更新（**この時点ではプレビューのみ。保存は既存の「保存」ボタンで PATCH に含める**）
- avatarUrl がある場合「画像を削除」ボタン（state を null に）
- アップロード失敗は既存の `profileMsg`（`role="status"`）にメッセージ表示

`onSaveProfile` の PATCH ボディに `avatarUrl` を追加（state 初期値は `me?.avatarUrl ?? null`）。**既存のフィールド・ラベル・パスワードフォームは不変。**

- [ ] **Step 2: テスト**

(1) ファイル選択でアップロード → 保存クリック → PATCH ボディに avatarUrl が含まれる (2) アップロード失敗でエラーメッセージ表示 — の 2 ケース（fetch/uploadImage をモック）。

- [ ] **Step 3: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`

```bash
git add apps/web
git commit -m "feat(web): add avatar upload to settings"
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
Expected: すべて green / ok / クリーン

- [ ] **Step 2: 未コミット残がないことを確認**

```bash
git status --short
```

---

## 完了後の検証（コントローラーが実施）

1. dev サーバー（pg_bigm 入り実 DB）でブラウザ通し: ヘッダー検索 → 日本語部分一致でヒット + スニペット表示 → カテゴリ/タグ絞り込み → 記事カードの著者名 → プロフィールページ（記事一覧）→ 設定でアバターアップロード（実 MinIO）→ プロフィールに反映 → ダークテーマ確認。
2. `EXPLAIN` で検索クエリが GIN インデックスを使うこと（実 DB 上で `explain select … lower(search_text) like lower('%…%')` に `articles_search_text_bigm_idx` が現れる）を確認。
3. 下書きのみに含まれる語で検索してヒットしないことを確認。
