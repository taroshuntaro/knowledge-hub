# UI/UX 刷新 S4: 記事詳細 + 認証/設定/管理 + 一貫性パス Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事詳細ページを確立したデザインシステム（ヒーロー・メタ情報・戻る導線・アクションボタン統一）で刷新し、認証・設定・管理の各画面と横断的な一貫性（ボタン階層・破壊的操作・アバター統一・空状態・絶対日付）を仕上げる。

**Architecture:** 記事詳細の表示に必要なメタ（categoryName / authorAvatarUrl / heroImage）を詳細 API に追加（一覧と同じ写像）。web は承認済みモックに沿って ArticleDetailPage を作り替え、S3 の `Avatar` を全画面で流用。残り画面（認証/設定/管理）は確立システムの適用と破壊的操作・空状態の統一が中心。

**Tech Stack:** Hono + Drizzle + PostgreSQL（Testcontainers）、React 19 + Vitest + Testing Library、Tailwind v4 トークン。

**Spec:** `docs/superpowers/specs/2026-07-07-ui-ux-overhaul-design.md` の §7（各画面適用）・§8（一貫性）・§10(S4)。記事詳細のビジュアルはビジュアルコンパニオンで承認済み（ヒーロー 16:9・戻る導線・メタ・アクション統一・~680px 本文幅）。

## Global Constraints

- 色はトークンのみ（生 hex 禁止）。破壊的操作は destructive スタイルのボタン（枠線）に統一し「赤いテキストリンク」混在を廃止。アバターは S3 `Avatar` に統一。日付は絶対表記（YYYY年M月D日）。
- 記事詳細のヒーローは**設定時のみ**表示（未設定なら出さない＝一覧のフォールバックタイルとは別扱い、spec §7）。
- 機能・API 契約・可視性/権限は変更しない（アクションの出し分けは既存の権限判定を流用）。
- 既存 web テストは構造変更に合わせて更新（E2E は後続 Phase 4c）。TDD（RED→GREEN）。
- コミットは英語 Conventional Commits。完了時 whole-branch レビュー → `pnpm run verify` green。

## ファイル構成

- Modify: `apps/server/src/services/article-service.ts`（`getArticleForViewer` に categoryName/authorAvatarUrl/heroImage、`ArticleDetail` 型拡張）
- Test: `apps/server/src/services/article-service.read.test.ts`
- Modify: `apps/web/src/pages/ArticleDetailPage.tsx`（承認モックに刷新）＋ test
- Modify: `apps/web/src/components/AuthShell.tsx`（ワードマーク/タグライン/区切り）＋ `LoginPage.tsx`（区切り線）
- Modify: `apps/web/src/pages/SettingsPage.tsx`（Avatar 統一）＋ test
- Modify: `apps/web/src/pages/AdminUsersPage.tsx`（テーブル hover・破壊的操作の destructive 化）＋ test
- Modify: `apps/web/src/pages/AdminCategoriesPage.tsx`（システム適用・破壊的操作）

---

### Task 1: 記事詳細 API のメタ拡張

**Files:**
- Modify: `apps/server/src/services/article-service.ts`（`ArticleDetail` 型・`getArticleForViewer`）
- Test: `apps/server/src/services/article-service.read.test.ts`

**Interfaces:**
- Produces: `ArticleDetail` に追加 `categoryName: string | null; authorAvatarUrl: string | null; heroImage: string | null;`（`heroImage` = `heroImageUploadId ? '/api/uploads/'+id : null`）。既存 `authorName`/`tags`/`ArticleRecord` フィールド（heroImageUploadId/categoryId/publishedAt 等）は維持。

- [ ] **Step 1: 失敗テストを書く**

```ts
it('記事詳細は categoryName・authorAvatarUrl・heroImage を含む', async () => {
  // category 付き・hero 画像あり の published 記事を seed（著者に avatarUrl 設定）
  const detail = await getArticleForViewer(db, articleId, viewer);
  expect(detail.categoryName).toBe('デザイン');
  expect(detail.heroImage).toBe(`/api/uploads/${uploadId}`);
  expect(detail.authorAvatarUrl).toBe(/* 著者 avatarUrl or null */);
});
it('カテゴリ/画像なしの記事は categoryName・heroImage が null', async () => { /* null 検証 */ });
```

RED 確認: `cd apps/server && npx vitest run src/services/article-service.read.test.ts`。

- [ ] **Step 2: 実装**

`ArticleDetail` 型に 3 フィールド追加。`getArticleForViewer` の author 取得を `displayName` + `avatarUrl` に拡張し、`categoryId` があればカテゴリ名を取得、`heroImage` を写像:

```ts
const [author] = await db
  .select({ name: users.displayName, avatarUrl: users.avatarUrl })
  .from(users).where(eq(users.id, row.authorId));
let categoryName: string | null = null;
if (row.categoryId) {
  const [c] = await db.select({ name: categories.name }).from(categories).where(eq(categories.id, row.categoryId));
  categoryName = c?.name ?? null;
}
const tagNames = await getArticleTagNames(db, id);
return {
  ...row,
  authorName: author?.name ?? '',
  authorAvatarUrl: author?.avatarUrl ?? null,
  categoryName,
  heroImage: row.heroImageUploadId ? `/api/uploads/${row.heroImageUploadId}` : null,
  tags: tagNames,
};
```

- [ ] **Step 3: GREEN＋型** — `npx vitest run src/services/article-service.read.test.ts`、`pnpm --filter @knowledge-hub/server test`、`pnpm -r typecheck`。

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/services/article-service.ts apps/server/src/services/article-service.read.test.ts
git commit -m "feat(server): add category, avatar and hero image to article detail"
```

---

### Task 2: 記事詳細ページの刷新（承認モック）

**Files:**
- Modify: `apps/web/src/pages/ArticleDetailPage.tsx`
- Test: `apps/web/src/pages/ArticleDetailPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 の拡張 `ArticleDetail`（categoryName/authorAvatarUrl/heroImage）、S3 `Avatar`、既存 `ReactionBar`/`CommentSection`、既存の権限判定（canEdit/canPin/canEngage）。

承認モック（`.superpowers/brainstorm/.../article-detail.html`）に沿う。現状の `ArticleDetailPage.tsx:58-90` を作り替え、既存の状態・ハンドラ（togglePin/moveToTrash/bookmark・権限フラグ）は維持したまま JSX を刷新する。

- [ ] **Step 1: 失敗テストを書く**（既存モック方式踏襲）

```tsx
it('ヒーロー・戻る導線・カテゴリ・タグ・著者・アクションを表示する', () => {
  // article を { heroImage:'/api/uploads/up1', categoryName:'デザイン', authorAvatarUrl:null, tags:['a'], publishedAt:'2026-07-05...' } でモック
  render(/* ArticleDetailPage with mocked article */);
  expect(screen.getByRole('link', { name: /フィードに戻る/ })).toBeInTheDocument();
  expect(screen.getByText('デザイン')).toBeInTheDocument();
  expect(screen.getByText('a')).toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute('src', '/api/uploads/up1'); // hero
});
it('ゴミ箱へは destructive ボタン（テキストリンクでない）', () => { /* role button name ゴミ箱へ を確認 */ });
```

RED 確認。

- [ ] **Step 2: 実装**

`<article>` を承認モック構成に刷新（`max-w-[42rem]` は維持でよい）:
- 先頭に `<Link to="/">← フィードに戻る</Link>`（`text-muted-foreground text-sm`）。
- `article.heroImage` があれば 16:9 `<img class="aspect-[16/9] w-full rounded-xl object-cover">`（未設定なら出さない）。
- `<h1>` タイトル。
- メタ行: `article.categoryName` があれば `/categories/:categoryId` へのチップ、著者は `<Avatar name={authorName} src={authorAvatarUrl} className="size-5">` ＋ `/users/:authorId` リンク、絶対日付（publishedAt ?? updatedAt）、タグ `/tags/:name`。
- アクション行（`border-b` 区切り）: 主 `編集`（`Button`、権限者のみ、`/articles/:id/edit`）／副 `ブックマーク`（既存 BookmarkButton か outline）・`ピン留め/解除`（admin）／右寄せで `ゴミ箱へ` を **`Button variant="outline"` に `border-destructive text-destructive` を当てた破壊的ボタン**に変更（現状の `variant="ghost" text-destructive` テキストリンクをやめる）。
- 本文 `.prose`（既存 Markdown レンダリング維持）。
- `ReactionBar` / `CommentSection`（既存維持、上下間隔を整える）。

- [ ] **Step 3: GREEN＋web** — `npx vitest run src/pages/ArticleDetailPage.test.tsx`、`pnpm --filter @knowledge-hub/web test`、`pnpm -r typecheck`。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ArticleDetailPage.tsx apps/web/src/pages/ArticleDetailPage.test.tsx
git commit -m "feat(web): rebuild article detail with hero, meta and unified actions"
```

---

### Task 3: 認証画面 ＋ 設定のブラッシュアップ

**Files:**
- Modify: `apps/web/src/components/AuthShell.tsx`（ワードマーク・タグライン）
- Modify: `apps/web/src/pages/LoginPage.tsx`（「または」区切りに罫線）
- Modify: `apps/web/src/pages/SettingsPage.tsx`（アバターを `Avatar` に統一）
- Test: `apps/web/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: S3 `Avatar`。既存の設定機能（プロフィール保存・アバターアップロード・パスワード変更）は不変。

- [ ] **Step 1: AuthShell のワードマーク＋タグライン**

`AuthShell.tsx` の見出し（現状プレーンテキスト `knowledge-hub`）を、フィード同様のワードマーク（`knowledge<span class="text-ring">·</span>hub`、`font-extrabold`）＋短い製品タグライン（例: `チームの知見を、流れる場所へ` を `text-sm text-muted-foreground`）に。装飾のみ・機能不変。

- [ ] **Step 2: LoginPage の「または」区切りに罫線**

`LoginPage.tsx` の SSO 併記時の「または」を、左右に `border-t` 罫線を持つ divider に（`flex items-center gap-3` で両側 `<span class="h-px flex-1 bg-border">`）。password/oidc 両有効時のみ表示は現状維持。

- [ ] **Step 3: SettingsPage のアバター統一（TDD）**

現状のアバタープレビュー（赤い丸などの素朴な表示）を S3 `Avatar`（`src={me.avatarUrl}` `name={me.displayName}`）に置換。アップロード/削除の機能・ハンドラは不変。`SettingsPage.test.tsx` に、アバターが `Avatar`（画像 or イニシャル）で表示されることの軽い検証を追加（既存アップロードテストは維持）。RED→GREEN。

- [ ] **Step 4: web 確認＋Commit**

Run: `pnpm --filter @knowledge-hub/web test`、`pnpm -r typecheck`。

```bash
git add apps/web/src/components/AuthShell.tsx apps/web/src/pages/LoginPage.tsx apps/web/src/pages/SettingsPage.tsx apps/web/src/pages/SettingsPage.test.tsx
git commit -m "feat(web): polish auth shell and unify settings avatar"
```

---

### Task 4: 管理画面 ＋ 一貫性スイープ

**Files:**
- Modify: `apps/web/src/pages/AdminUsersPage.tsx`（テーブル hover・破壊的操作）＋ test
- Modify: `apps/web/src/pages/AdminCategoriesPage.tsx`（破壊的操作・システム適用）
- Modify: 一貫性のため必要に応じて各一覧の空状態（`EmptyState` 使用箇所）と日付表記を確認

**Interfaces:**
- Consumes: S3 `Avatar`（ユーザー一覧の表示名にアバターを付けてもよい）。既存の管理機能・権限は不変。

- [ ] **Step 1: AdminUsersPage のテーブル可読性＋破壊的操作（TDD）**

- 各行に hover 背景（`hover:bg-muted/50`）。表示名セルに `Avatar`（任意）。
- **破壊的操作の destructive 化**: 「無効化」ボタンを `Button variant="outline"` に `border-destructive text-destructive` を当てた破壊的スタイルに（「有効化」「メンバーにする/管理者にする」は通常 outline のまま）。
- `AdminUsersPage.test.tsx` に「無効化ボタンが破壊的スタイル（destructive クラス）で表示される」旨の軽い検証を追加、または既存テストが壊れないことを確認。RED→GREEN（構造変更でセレクタが変わる場合はテスト更新）。

- [ ] **Step 2: AdminCategoriesPage の破壊的操作＋システム適用**

カテゴリ削除ボタンを同じ destructive スタイルに統一。カード/フォームは既存トークンに沿っていることを確認（生色があれば置換）。機能不変。

- [ ] **Step 3: 一貫性スイープ（横断・小修正）**

grep で以下を洗い、統一する（機能変更なし）:
- `text-destructive` を使った**テキストリンク的な破壊操作**が残っていないか（あれば destructive ボタン化）。
- 空一覧が `EmptyState`（アイコン＋文言）を使っているか（`ArticleList` 経由は済。個別ページで生の「〜がありません」テキストがあれば `EmptyState` に）。
- 日付表記が絶対表記か（相対表記が残っていれば統一）。
Run: `grep -rn "text-destructive" apps/web/src` 等で確認し、該当箇所のみ最小修正。

- [ ] **Step 4: web 全体＋build＋contrast＋Commit**

Run: `pnpm --filter @knowledge-hub/web test`、`pnpm --filter @knowledge-hub/web check:contrast`、`pnpm --filter @knowledge-hub/web build`、`pnpm -r typecheck`（すべて green/クリーン）。

```bash
git add apps/web/src/pages/AdminUsersPage.tsx apps/web/src/pages/AdminUsersPage.test.tsx apps/web/src/pages/AdminCategoriesPage.tsx
git commit -m "feat(web): unify admin destructive actions and consistency pass"
```

---

## 完了条件

- 全タスク後、最終 whole-branch レビュー → `pnpm run verify` exit 0。
- 記事詳細がヒーロー・メタ・戻る導線・統一アクションで表示され、破壊的操作は全画面で destructive ボタンに統一、アバターは `Avatar` に一本化。
- コントローラー実 DB/実ブラウザ確認（任意・マージ判断前）: 記事詳細（ヒーローあり/なし）・設定・ユーザー管理・ログイン、ライト/ダーク。
- 本 S4 完了で UI/UX 刷新（S1〜S4）が完了。以後は Phase 4c（E2E + 仕上げ、M-6 SMTP・M-7 本番設定含む）。
