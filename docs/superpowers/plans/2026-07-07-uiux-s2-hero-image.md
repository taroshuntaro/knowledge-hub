# UI/UX 刷新 S2: 記事ヒーロー画像 ＋ 一覧 API 拡張 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事に 16:9 ヒーロー画像を設定できるようにし（スキーマ＋エディタ UI）、一覧 API をカード表示に必要なデータ（ヒーロー画像・カテゴリ名・著者アバター・タグ・反応/コメント数）で拡張する。

**Architecture:** 既存の S3 互換アップロード基盤（`saveUpload`/`getUpload`・magic-byte 検証）をそのまま流用。`articles.hero_image_upload_id`（nullable FK → uploads）を追加。一覧の付加情報はページ内 articleId 集合に対する集約 1 クエリずつ（N+1 回避）でまとめて解決する。カードや詳細の**表示**は S3/S4 の担当で、本 S2 は「データを持てる・返せる・設定できる」状態までを作る。

**Tech Stack:** Drizzle ORM + PostgreSQL（drizzle-kit migrate、Testcontainers 実 DB テスト）、Hono、Zod（shared）、React 19（EditorPage）、Vitest。

**Spec:** `docs/superpowers/specs/2026-07-07-ui-ux-overhaul-design.md` の §5.1（一覧 API 拡張）・§6（ヒーロー画像）・§10(S2)。

## Global Constraints

- ヒーロー画像は既存アップロード基盤流用: `saveUpload(db, storage, uploaderId, {buffer,mimeType,size}) → {id,url}`、配信は既存 `GET /api/uploads/:id`。新しいアップロード経路は作らない。
- `articles.hero_image_upload_id uuid null references uploads(id)`。既存の可視性/権限/カーソルページング/論理削除/リビジョン挙動は変更しない。
- 一覧の付加情報（tags・reactionCount・commentCount）は**ページ内 articleId 集合に対する集約 1 クエリ**で解決（N+1 禁止）。件数は実数。
- 追加する型は `packages/shared` に定義し hono RPC で web が消費。既存 `ArticleListItem` への追加は additive（既存消費側を壊さない）。
- サーバーテストは Testcontainers 実 PostgreSQL。マイグレーションは `drizzle-kit generate` で生成し、テストの DB セットアップが適用する（生成物 SQL をコミット）。
- 画像なし時は API が `heroImage: null` を返す（フォールバック描画は S3）。
- コミットは英語 Conventional Commits。TDD（RED→実装→GREEN）。完了時 `pnpm run verify` green を S2 whole-branch で確認。

## ファイル構成

- Modify: `apps/server/src/db/schema.ts`（articles に heroImageUploadId）
- Create: `apps/server/drizzle/0005_*.sql`（drizzle-kit 生成）＋ `apps/server/drizzle/meta/*` 更新
- Modify: `packages/shared/src/schemas/article.ts`（create/update に heroImageUploadId）
- Modify: `apps/server/src/services/article-service.ts`（ArticleInput・create/update・ArticleListItem・enrichListItems・pagePublished/listMine）
- Modify: `apps/server/src/services/article-service.*.test.ts`（該当テスト）
- Modify: `apps/web/src/pages/EditorPage.tsx`（heroImageUploadId state/load/save ＋設定 UI）
- Create: `apps/web/src/components/HeroImageInput.tsx`（16:9 設定 UI）＋ `HeroImageInput.test.tsx`
- Modify: `apps/web/src/pages/EditorPage.test.tsx`

---

### Task 1: スキーマ＋マイグレーション＋作成/更新での永続化

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/0005_*.sql`（生成）
- Modify: `packages/shared/src/schemas/article.ts`
- Modify: `apps/server/src/services/article-service.ts`（`ArticleInput`・`createArticle`・`updateArticle`）
- Test: `apps/server/src/services/article-service.write.test.ts`

**Interfaces:**
- Produces: `articles.heroImageUploadId: string | null`（`$inferSelect` に含まれる）。`ArticleInput` に `heroImageUploadId?: string | null` を追加。shared の作成/更新スキーマに `heroImageUploadId: z.string().uuid().nullable().optional()`。

- [ ] **Step 1: 失敗テストを書く**（既存 write テストの seed/ヘルパー流儀を踏襲）

```ts
it('作成時に heroImageUploadId を保存できる', async () => {
  const upload = /* 既存のアップロード seed か saveUpload で uploads 行を作る（uploaderId は作成者） */;
  const row = await createArticle(db, author.id, { title: 't', bodyMd: 'b', tags: [], heroImageUploadId: upload.id });
  expect(row.heroImageUploadId).toBe(upload.id);
});
it('更新で heroImageUploadId を差し替え・null 化できる', async () => {
  const article = /* draft 作成（hero あり）*/;
  const updated = await updateArticle(db, article.id, author, { title: 't2', bodyMd: 'b', tags: [], heroImageUploadId: null, expectedUpdatedAt: article.updatedAt.toISOString() });
  expect(updated.heroImageUploadId).toBeNull();
});
```

- [ ] **Step 2: RED 確認** — Run: `cd apps/server && npx vitest run src/services/article-service.write.test.ts` → FAIL（列/入力未対応）。

- [ ] **Step 3: schema に列追加**

`apps/server/src/db/schema.ts` の `articles` テーブル定義に追加（`categoryId` の近く）:

```ts
  heroImageUploadId: uuid('hero_image_upload_id').references(() => uploads.id),
```

注: `uploads` は同ファイル内で `articles` より後方に定義されているため、`references(() => uploads.id)` の遅延参照（アロー）で循環を回避する（既存 `authorId`/`categoryId` と同じ書き方）。参照順で TS エラーが出る場合は `uploads` 定義を `articles` より前に移動してよい（他参照に影響しないことを typecheck で確認）。

- [ ] **Step 4: マイグレーション生成**

Run: `pnpm --filter @knowledge-hub/server db:generate`
Expected: `apps/server/drizzle/0005_*.sql` が生成され、内容は `ALTER TABLE "articles" ADD COLUMN "hero_image_upload_id" uuid;` ＋ FK 制約（`REFERENCES "uploads"("id")`）。`drizzle/meta/_journal.json` 等も更新される。生成物を確認する。

- [ ] **Step 5: shared スキーマに追加**

`packages/shared/src/schemas/article.ts` の作成スキーマと更新スキーマ両方に追加:

```ts
  heroImageUploadId: z.string().uuid().nullable().optional(),
```

- [ ] **Step 6: article-service を対応**

`ArticleInput` 型に `heroImageUploadId?: string | null;` を追加。`createArticle` の `insert(articles).values({...})` に `heroImageUploadId: input.heroImageUploadId ?? null,` を追加。`updateArticle` のトランザクション内 `update(articles).set({...})` に `heroImageUploadId: input.heroImageUploadId ?? null,` を追加（既存の楽観ロック・カテゴリ検査・通知はそのまま）。

- [ ] **Step 7: GREEN＋型** — Run: `npx vitest run src/services/article-service.write.test.ts`（PASS）、`pnpm --filter @knowledge-hub/shared test`、`pnpm -r typecheck`（クリーン）。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle packages/shared/src/schemas/article.ts apps/server/src/services/article-service.ts apps/server/src/services/article-service.write.test.ts
git commit -m "feat(server): add article hero image column and persist it"
```

---

### Task 2: 一覧 API のデータ拡張（§5.1・N+1 回避の集約）

**Files:**
- Modify: `apps/server/src/services/article-service.ts`（`ArticleListItem`・`LIST_COLUMNS`・新 `enrichListItems`・`pagePublished`・`listMine`）
- Test: `apps/server/src/services/article-service.read.test.ts`

**Interfaces:**
- Consumes: Task 1 の `articles.heroImageUploadId`。既存 `articleTags`/`tags`/`reactions`/`comments`/`categories`/`users` テーブル。
- Produces: `ArticleListItem` に追加: `heroImage: string | null`（= `/api/uploads/<id>` or null）・`categoryName: string | null`・`authorAvatarUrl: string | null`・`tags: string[]`・`reactionCount: number`・`commentCount: number`。`export async function enrichListItems(db: Db, items: ArticleListItem[]): Promise<ArticleListItem[]>`（items をページ単位で受け、集約でまとめて埋める）。

- [ ] **Step 1: 失敗テストを書く**

```ts
it('フィード一覧はカテゴリ名・タグ・反応数・コメント数・ヒーロー画像を含む', async () => {
  // published 記事を作成（category 付き・tags ['a','b']・hero 画像あり・reaction 2件・comment 1件を seed）
  const page = await listFeed(db, { limit: 20 });
  const item = page.items.find((i) => i.id === articleId)!;
  expect(item.categoryName).toBe('デザイン');
  expect(item.tags.sort()).toEqual(['a', 'b']);
  expect(item.reactionCount).toBe(2);
  expect(item.commentCount).toBe(1);
  expect(item.heroImage).toBe(`/api/uploads/${uploadId}`);
  expect(item.authorAvatarUrl).toBe(/* 著者の avatarUrl or null */);
});
it('付加情報がゼロの記事は空配列・0・null を返す', async () => {
  const page = await listFeed(db, { limit: 20 });
  const bare = page.items.find((i) => i.id === bareArticleId)!;
  expect(bare.tags).toEqual([]); expect(bare.reactionCount).toBe(0);
  expect(bare.commentCount).toBe(0); expect(bare.heroImage).toBeNull();
});
```

- [ ] **Step 2: RED 確認** — Run: `npx vitest run src/services/article-service.read.test.ts` → FAIL（フィールド未定義）。

- [ ] **Step 3: 実装**

`ArticleListItem` 型に上記フィールドを追加。`LIST_COLUMNS` に `heroImageUploadId: articles.heroImageUploadId`、`categoryName: categories.name`（`leftJoin(categories, eq(articles.categoryId, categories.id))` を各一覧クエリに追加）、`authorAvatarUrl: users.avatarUrl` を追加（users は既に innerJoin 済み）。

`enrichListItems` を新設（ページ内 items の id 集合に対する集約 3 本 ＋ heroImage の写像）:

```ts
export async function enrichListItems(db: Db, items: ArticleListItem[]): Promise<ArticleListItem[]> {
  if (items.length === 0) return items;
  const ids = items.map((i) => i.id);
  const tagRows = await db
    .select({ articleId: articleTags.articleId, name: tags.name })
    .from(articleTags).innerJoin(tags, eq(articleTags.tagId, tags.id))
    .where(inArray(articleTags.articleId, ids));
  const reactionRows = await db
    .select({ articleId: reactions.articleId, count: sql<number>`count(*)::int` })
    .from(reactions).where(inArray(reactions.articleId, ids)).groupBy(reactions.articleId);
  const commentRows = await db
    .select({ articleId: comments.articleId, count: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(inArray(comments.articleId, ids), isNull(comments.deletedAt)))
    .groupBy(comments.articleId);
  const tagsByArticle = new Map<string, string[]>();
  for (const r of tagRows) { const a = tagsByArticle.get(r.articleId) ?? []; a.push(r.name); tagsByArticle.set(r.articleId, a); }
  const reactionByArticle = new Map(reactionRows.map((r) => [r.articleId, r.count]));
  const commentByArticle = new Map(commentRows.map((r) => [r.articleId, r.count]));
  return items.map((i) => ({
    ...i,
    tags: tagsByArticle.get(i.id) ?? [],
    reactionCount: reactionByArticle.get(i.id) ?? 0,
    commentCount: commentByArticle.get(i.id) ?? 0,
  }));
}
```

注: `heroImage`・`categoryName`・`authorAvatarUrl` は SELECT で取得した生の値から `pagePublished`/`listMine` 内で写像する（`heroImage: row.heroImageUploadId ? \`/api/uploads/${row.heroImageUploadId}\` : null`）。`reactions`/`comments`/`isNull`/`inArray`/`sql`/`and` を import に追加（`reactions`,`comments` は `../db/schema` から、他は drizzle-orm から）。`pagePublished` と `listMine` は、行を items に整形後 `return { items: await enrichListItems(db, items), nextCursor }` にする（`listPickup` も同様に enrich する）。

- [ ] **Step 4: GREEN＋型** — Run: `npx vitest run src/services/article-service.read.test.ts`（PASS）、`pnpm --filter @knowledge-hub/server test`（全 PASS）、`pnpm -r typecheck`（web が新フィールドで壊れないこと＝additive を確認）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/article-service.ts apps/server/src/services/article-service.read.test.ts
git commit -m "feat(server): enrich article list items with card metadata"
```

---

### Task 3: エディタのヒーロー画像設定 UI（16:9）

**Files:**
- Create: `apps/web/src/components/HeroImageInput.tsx`
- Create: `apps/web/src/components/HeroImageInput.test.tsx`
- Modify: `apps/web/src/pages/EditorPage.tsx`
- Modify: `apps/web/src/pages/EditorPage.test.tsx`

**Interfaces:**
- Consumes: 既存アップロード API（`api.api.uploads.$post` を form-data で叩く既存パターン。`apps/web/src/lib/upload.ts` または EditorPage の既存画像アップロード処理を参照して同じ関数を再利用する）。Task 1 の作成/更新ペイロードの `heroImageUploadId`。
- Produces: `export function HeroImageInput(props: { value: string | null; onChange: (uploadId: string | null) => void }): JSX.Element`。`value` は uploadId（表示は `/api/uploads/<id>`）。

- [ ] **Step 1: HeroImageInput 失敗テストを書く**（既存アップロード呼び出しをモック）

```tsx
it('画像未設定なら 16:9 のプレースホルダと「画像を選択」を表示する', () => {
  render(<HeroImageInput value={null} onChange={() => {}} />);
  expect(screen.getByText('画像を選択')).toBeInTheDocument();
});
it('ファイル選択でアップロードし onChange に uploadId を渡す', async () => {
  const onChange = vi.fn();
  // uploads.$post が { id: 'up1', url: '/api/uploads/up1' } を返すようモック
  render(<HeroImageInput value={null} onChange={onChange} />);
  const file = new File([new Uint8Array([1,2,3])], 'h.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText('ヒーロー画像を選択'), file);
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('up1'));
});
it('設定済みなら画像プレビューと「削除」を表示し、削除で onChange(null)', async () => {
  const onChange = vi.fn();
  render(<HeroImageInput value="up1" onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: '画像を削除' }));
  expect(onChange).toHaveBeenCalledWith(null);
});
```

- [ ] **Step 2: RED 確認** — Run: `cd apps/web && npx vitest run src/components/HeroImageInput.test.tsx` → FAIL。

- [ ] **Step 3: HeroImageInput を実装**

16:9 の枠（`aspect-[16/9]`）に、`value` があれば `<img src={\`/api/uploads/${value}\`}>` を `object-cover` で表示＋「画像を削除」ボタン、なければ破線プレースホルダ＋「画像を選択」ラベル付き `<input type="file" accept="image/*" aria-label="ヒーロー画像を選択">`。選択時は既存アップロード関数（EditorPage が本文画像で使っているものと同一の `api.api.uploads.$post` form-data 呼び出し）で保存し、成功時 `onChange(result.id)`。アップロード中は簡易な無効化/表示。生色は使わずトークン（`border`/`muted`/`accent`）で。

- [ ] **Step 4: GREEN 確認** — Run: `npx vitest run src/components/HeroImageInput.test.tsx`（PASS）。

- [ ] **Step 5: EditorPage に組み込む（TDD）**

`apps/web/src/pages/EditorPage.test.tsx` に、既存記事ロード時に heroImageUploadId が反映され、公開/保存ペイロードに `heroImageUploadId` が含まれることを検証するテストを追加（既存のモック方式踏襲）。RED 確認 → 実装:

- `const [heroImageUploadId, setHeroImageUploadId] = useState<string | null>(null);` を追加。
- ロード effect（`setTitle(a.title)...` の並び）に `setHeroImageUploadId(a.heroImageUploadId ?? null);` を追加。
- タイトル入力の近く（カテゴリの上あたり）に `<HeroImageInput value={heroImageUploadId} onChange={setHeroImageUploadId} />` を配置（`<Label>ヒーロー画像</Label>` 付き）。
- 保存ペイロード（create の POST と update の PATCH の json）に `heroImageUploadId` を含める。

- [ ] **Step 6: GREEN＋web 全体** — Run: `npx vitest run src/pages/EditorPage.test.tsx`、`pnpm --filter @knowledge-hub/web test`、`pnpm --filter @knowledge-hub/web build`、`pnpm -r typecheck`（すべて green/クリーン）。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/HeroImageInput.tsx apps/web/src/components/HeroImageInput.test.tsx apps/web/src/pages/EditorPage.tsx apps/web/src/pages/EditorPage.test.tsx
git commit -m "feat(web): add hero image setter to article editor"
```

---

## 完了条件

- 全タスク後、最終 whole-branch レビュー → `pnpm run verify` exit 0。
- 一覧 API が heroImage/categoryName/authorAvatarUrl/tags/reactionCount/commentCount を返し、記事にヒーロー画像を設定・差し替え・削除できる（表示は S3/S4）。
- コントローラー実 DB/実ブラウザ確認（任意・マージ判断前）: エディタで 16:9 ヒーロー画像を設定→保存→再ロードで反映、フィード API がメタ情報を返す。
