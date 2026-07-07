# EditorPage 刷新（S5）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記事エディタ（EditorPage）を「記事詳細ページをその場で編集する」執筆没入キャンバスへ刷新し、ヒーロー画像を 16:9 contain＋ぼかし背景に統一、カテゴリ/タグを公開パネルへ分離、一覧サムネを 4:3 cover にする。

**Architecture:** 表示比率は用途ごとに固定（ヒーロー=16:9 contain＋blur backdrop / サムネ=4:3 cover）し、任意比率の画像を `object-fit` で吸収する。ヒーロー表示は共通コンポーネント `HeroImage` に切り出してエディタ入力と記事詳細で見た目を一致させる。EditorPage は sticky アクションバー＋キャンバスの 2 層にし、公開系メタ（カテゴリ/タグ）は radix Dialog の公開パネルへ集約する。既存の自動保存直列化・リッチ/Markdown 変換・画像 D&D は無改変で維持する。

**Tech Stack:** React 19 SPA (Vite 7), TanStack Query, React Router v7, radix-ui (`import { Dialog, VisuallyHidden } from 'radix-ui'`), shadcn/ui + Tailwind v4（`@theme` トークン、生 hex 禁止）, lucide-react, Vitest + React Testing Library + userEvent。

## Global Constraints

- パッケージ: pnpm 10 workspaces、TypeScript strict、ESM、Node 22。web は `@knowledge-hub/web`。
- Tailwind v4 CSS-first。**生 hex を新規に持ち込まない**。色は既存トークン（`bg-card`, `text-muted-foreground`, `border-destructive` 等）を使う。
- radix は統合パッケージ: `import { Dialog, VisuallyHidden } from 'radix-ui'`（`@radix-ui/react-*` を個別 import しない）。
- 既存の日本語ラベルを壊さない: `getByLabelText('タイトル')`、`getByRole('button', { name: '下書き保存' })`、`{ name: 'リッチ' }` / `{ name: 'Markdown' }`、ヒーロー削除 `aria-label="画像を削除"`、設定済みヒーロー img `alt="ヒーロー画像"`（エディタ入力側）。
- ソースモードの CodeMirror ラッパーの className `overflow-hidden rounded-lg border` を維持（`EditorPage.test.tsx` が `document.querySelector('.overflow-hidden.rounded-lg.border')` で特定している）。
- DB スキーマ・サーバー API は変更しない。publish 時カテゴリ必須はサーバー `publishArticle` で既存担保（`categoryId` 無しは 400）。
- コミットは英語 Conventional Commits（subject 小文字・末尾ピリオドなし・命令形）。
- 各タスク末尾で最低限 `pnpm --filter @knowledge-hub/web test`（該当ファイル）を緑にする。全タスク後に `pnpm run verify` を緑にしてからレビュー/マージ。

## File Structure

- `apps/web/src/components/HeroImage.tsx`（新規）— 16:9 枠に画像を contain 表示し、余白をぼかし背景で埋める純表示コンポーネント。エディタ入力・記事詳細の両方が使う。
- `apps/web/src/components/HeroImage.test.tsx`（新規）— HeroImage の単体テスト。
- `apps/web/src/components/ArticleCard.tsx`（修正）— 左サムネを 4:3 cover へ。
- `apps/web/src/pages/ArticleDetailPage.tsx`（修正）— ヒーロー img を `HeroImage` へ差し替え。
- `apps/web/src/components/HeroImageInput.tsx`（修正）— 未設定=1 行トリガー、設定時=`HeroImage` プレビュー＋変更/削除。
- `apps/web/src/components/HeroImageInput.test.tsx`（新規）— 未設定/設定時の表示。
- `apps/web/src/pages/EditorPage.tsx`（修正）— sticky アクションバー＋キャンバス、タイトル見出し化、保存状態インジケータ、ステータスバッジ、戻る導線（Task 5）／公開パネル（Task 6）。
- `apps/web/src/pages/EditorPage.test.tsx`（修正）— 新レイアウト＋公開パネルフローへ追随。

---

### Task 1: 一覧サムネを 4:3 cover にする

**Files:**
- Modify: `apps/web/src/components/ArticleCard.tsx:16-24`
- Test: `apps/web/src/components/ArticleCard.test.tsx`（既存、非回帰確認）

**Interfaces:**
- Consumes: `ArticleItem`（= `ArticleCardData`）の `heroImage`, `categoryId`, `categoryName`, `title`。
- Produces: なし（表示のみ）。

これはスタイル（クラス）変更で、既存テストは `getByRole('img')`（単一 img）と `getByText('エ')`（フォールバック頭文字）を見ており比率はアサートしていない。よって既存テストを壊さず維持することが受け入れ基準。

- [ ] **Step 1: 既存テストが緑であることを先に確認**

Run: `pnpm --filter @knowledge-hub/web test -- ArticleCard`
Expected: PASS（3 件）

- [ ] **Step 2: サムネ枠を 4:3 固定 cover に変更**

`apps/web/src/components/ArticleCard.tsx` の左サムネ `<Link>` ブロックを次に置き換える。サムネ枠自体を `aspect-[4/3]` にし、画像・フォールバックとも 4:3 枠を埋める。カード高さがサムネで暴れないよう、枠は幅基準（`w-28 sm:w-40`）＋`aspect-[4/3]` とし、`self-stretch` は外して枠比率で高さを決める。

```tsx
      <Link to={`/articles/${item.id}`} className="w-28 shrink-0 sm:w-40" aria-hidden tabIndex={-1}>
        {item.heroImage ? (
          <img src={item.heroImage} alt="" className="aspect-[4/3] h-full w-full object-cover" />
        ) : (
          <div className={`flex aspect-[4/3] h-full w-full items-center justify-center text-2xl font-bold ${item.categoryId ? `${categoryColorClass(item.categoryId)} text-white` : 'bg-muted text-muted-foreground'}`}>
            {(item.categoryName ?? item.title).slice(0, 1)}
          </div>
        )}
      </Link>
```

補足: `items-stretch`（`<article>` 既定）のままだと右カラムが高い時にサムネが縦伸びして 4:3 が崩れる場合がある。まず上記のまま Step 3 を確認し、視覚的に破綻する場合のみ `<article>` の `items-stretch` を `items-start` に切り替える（テストは緑のまま）。

- [ ] **Step 3: 既存テストで非回帰を確認**

Run: `pnpm --filter @knowledge-hub/web test -- ArticleCard`
Expected: PASS（3 件のまま。img の src、フォールバック頭文字が維持されている）

- [ ] **Step 4: 型確認**

Run: `pnpm --filter @knowledge-hub/web typecheck`
Expected: エラーなし

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ArticleCard.tsx
git commit -m "feat(web): switch list card thumbnail to 4:3 cover"
```

---

### Task 2: 共通ヒーロー表示コンポーネント HeroImage（16:9 contain＋ぼかし背景）

**Files:**
- Create: `apps/web/src/components/HeroImage.tsx`
- Test: `apps/web/src/components/HeroImage.test.tsx`

**Interfaces:**
- Consumes: なし。
- Produces: `export function HeroImage(props: { src: string; alt: string; className?: string }): JSX.Element`
  - 16:9 の枠を描画。枠内に「背景 img（同 src, `object-cover`, `blur`, `aria-hidden`）」と「前景 img（同 src, `object-contain`, `alt`）」を重ねる。前景のみアクセシビリティツリーに出る（`getByRole('img')` は前景 1 枚だけにマッチする）。

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/components/HeroImage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeroImage } from './HeroImage';

describe('HeroImage', () => {
  it('前景画像に alt と src を設定する（アクセシブルな img は 1 枚だけ）', () => {
    render(<HeroImage src="/api/uploads/up1" alt="記事タイトル" />);
    const img = screen.getByRole('img', { name: '記事タイトル' });
    expect(img).toHaveAttribute('src', '/api/uploads/up1');
    expect(img.className).toContain('object-contain');
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('ぼかし背景の img は同じ src を持ち aria-hidden で隠される', () => {
    const { container } = render(<HeroImage src="/api/uploads/up1" alt="記事タイトル" />);
    const hidden = container.querySelector('img[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
    expect(hidden).toHaveAttribute('src', '/api/uploads/up1');
    expect(hidden!.className).toContain('object-cover');
    expect(hidden!.className).toContain('blur');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/web test -- HeroImage`
Expected: FAIL（`HeroImage` が存在しない）

- [ ] **Step 3: HeroImage を実装**

`apps/web/src/components/HeroImage.tsx`:

```tsx
/**
 * 記事のヒーロー画像を 16:9 の枠に contain 表示する。16:9 の画像は枠を
 * 埋め、4:3 など縦長の画像は高さを 16:9 に合わせて左右に余白ができる。
 * 余白は同じ画像を拡大・ぼかした背景で自然に埋める（ピラーボックス）。
 * エディタ入力プレビューと記事詳細ページで同じ見た目にするための共通表示。
 */
export function HeroImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-muted ${className ?? ''}`}>
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl brightness-90"
      />
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 mx-auto h-full w-auto max-w-full object-contain"
      />
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/web test -- HeroImage`
Expected: PASS（2 件）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/HeroImage.tsx apps/web/src/components/HeroImage.test.tsx
git commit -m "feat(web): add HeroImage component (16:9 contain with blur backdrop)"
```

---

### Task 3: 記事詳細のヒーローを HeroImage に差し替え

**Files:**
- Modify: `apps/web/src/pages/ArticleDetailPage.tsx`（ヒーロー img 部分、現状 `mt-3 aspect-[16/9] w-full rounded-xl object-cover` の `<img>`）
- Test: `apps/web/src/pages/ArticleDetailPage.test.tsx`（既存 'ヒーロー画像を表示する' を維持）

**Interfaces:**
- Consumes: Task 2 の `HeroImage`（`{ src, alt }`）。`article.heroImage: string | null`, `article.title: string`。
- Produces: なし。

既存テストは `getByRole('img', { name: '記事タイトル' })`（article.title === '記事タイトル'）で hero を特定し src を確認する。HeroImage の前景 img は `alt={title}`、背景は `aria-hidden` なので、この特定は 1 枚にマッチし続ける。

- [ ] **Step 1: 既存テストが緑であることを確認**

Run: `pnpm --filter @knowledge-hub/web test -- ArticleDetailPage`
Expected: PASS（'ヒーロー画像を表示する' を含む）

- [ ] **Step 2: import を追加**

`apps/web/src/pages/ArticleDetailPage.tsx` の import 群に追加:

```tsx
import { HeroImage } from '@/components/HeroImage';
```

- [ ] **Step 3: ヒーロー img を HeroImage に置き換え**

現状:

```tsx
      {article.heroImage && (
        <img
          src={article.heroImage}
          alt={article.title}
          className="mt-3 aspect-[16/9] w-full rounded-xl object-cover"
        />
      )}
```

を次に置き換える:

```tsx
      {article.heroImage && (
        <HeroImage src={article.heroImage} alt={article.title} className="mt-3" />
      )}
```

- [ ] **Step 4: テストで非回帰を確認**

Run: `pnpm --filter @knowledge-hub/web test -- ArticleDetailPage`
Expected: PASS（'ヒーロー画像を表示する' が緑。`getByRole('img', { name: '記事タイトル' })` の src が hero.png）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ArticleDetailPage.tsx
git commit -m "feat(web): render article detail hero via HeroImage"
```

---

### Task 4: HeroImageInput を未設定=1 行トリガー / 設定時=HeroImage プレビューに刷新

**Files:**
- Modify: `apps/web/src/components/HeroImageInput.tsx`（全面。props シグネチャ `{ value: string | null; onChange: (uploadId: string | null) => void }` は不変）
- Test: `apps/web/src/components/HeroImageInput.test.tsx`（新規）

**Interfaces:**
- Consumes: Task 2 の `HeroImage`。既存 `uploadImageWithId`（`@/lib/upload`）。
- Produces: props 不変。設定済みプレビュー img は `alt="ヒーロー画像"`、削除ボタンは `aria-label="画像を削除"` を維持（EditorPage 既存テスト互換）。未設定トリガーのアクセシブル名は「ヒーロー画像を追加」。

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/components/HeroImageInput.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HeroImageInput } from './HeroImageInput';

describe('HeroImageInput', () => {
  it('未設定時は上部を占有しないコンパクトな追加トリガーを出す', () => {
    render(<HeroImageInput value={null} onChange={vi.fn()} />);
    expect(screen.getByText(/ヒーロー画像を追加/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'ヒーロー画像' })).not.toBeInTheDocument();
  });

  it('設定済み時は HeroImage プレビューと削除ボタンを出す', () => {
    render(<HeroImageInput value="up1" onChange={vi.fn()} />);
    const img = screen.getByRole('img', { name: 'ヒーロー画像' });
    expect(img).toHaveAttribute('src', '/api/uploads/up1');
    expect(screen.getByRole('button', { name: '画像を削除' })).toBeInTheDocument();
  });

  it('削除ボタンで onChange(null) を呼ぶ', () => {
    const onChange = vi.fn();
    render(<HeroImageInput value="up1" onChange={onChange} />);
    screen.getByRole('button', { name: '画像を削除' }).click();
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/web test -- HeroImageInput`
Expected: FAIL（未設定トリガー文言・HeroImage プレビュー未実装）

- [ ] **Step 3: HeroImageInput を実装**

`apps/web/src/components/HeroImageInput.tsx` を次に置き換える（アップロード処理は現状ロジックを保持し UI のみ刷新）:

```tsx
import { useId, useState } from 'react';
import { ImageIcon, X } from 'lucide-react';
import { uploadImageWithId } from '@/lib/upload';
import { HeroImage } from '@/components/HeroImage';

/** 記事のヒーロー画像を設定・差し替え・削除する UI。value は uploadId。
 *  未設定時は上部を占有しないコンパクトな追加トリガー、設定時は 16:9
 *  contain＋ぼかし背景のプレビュー（HeroImage）と変更/削除操作を出す。 */
export function HeroImageInput(props: { value: string | null; onChange: (uploadId: string | null) => void }) {
  const { value, onChange } = props;
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { id } = await uploadImageWithId(file);
      onChange(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像のアップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      {value ? (
        <div className="relative">
          <HeroImage src={`/api/uploads/${value}`} alt="ヒーロー画像" />
          <div className="absolute right-2 top-2 flex gap-1.5">
            <label
              htmlFor={inputId}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-background/80 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {uploading ? 'アップロード中…' : '画像を変更'}
            </label>
            <button
              type="button"
              aria-label="画像を削除"
              onClick={() => onChange(null)}
              className="inline-flex items-center justify-center rounded-md bg-background/80 p-1.5 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ImageIcon className="size-4" aria-hidden="true" />
          <span>{uploading ? 'アップロード中…' : 'ヒーロー画像を追加（任意）'}</span>
        </label>
      )}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        aria-label="ヒーロー画像を選択"
        disabled={uploading}
        onChange={(e) => void handleFileChange(e)}
        className="sr-only"
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

補足: file input を 1 つに統一し、未設定トリガーと「画像を変更」ラベルの両方が同じ `htmlFor={inputId}` を指す。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/web test -- HeroImageInput`
Expected: PASS（3 件）

- [ ] **Step 5: EditorPage 既存テストの非回帰を確認**

Run: `pnpm --filter @knowledge-hub/web test -- EditorPage`
Expected: PASS（'既存記事のロードで heroImageUploadId が反映され...' の `getByRole('img', { name: 'ヒーロー画像' })` が緑）

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/HeroImageInput.tsx apps/web/src/components/HeroImageInput.test.tsx
git commit -m "feat(web): rework hero image input (compact trigger, HeroImage preview)"
```

---

### Task 5: EditorPage — sticky アクションバー＋キャンバス骨格（タイトル見出し化・保存状態・ステータス・戻る）

**Files:**
- Modify: `apps/web/src/pages/EditorPage.tsx`
- Test: `apps/web/src/pages/EditorPage.test.tsx`（追加）

**Interfaces:**
- Consumes: 既存 state（`title`, `bodyMd`, `categoryId`, `heroImageUploadId`, `tags`, `updatedAt`, `status`, `error`, `mode`）、既存関数（`enqueueSave`, `publish`, `handleClickRich`, `handleClickSource`, `handleSourceImageUpload`）。
- Produces: このタスクでは「公開する」ボタンは現状のまま直 publish を維持（公開パネル化は Task 6）。カテゴリ/タグ入力もこのタスクではキャンバスに残す（Task 6 で公開パネルへ移動）。新規に保存状態 `saveState: 'idle' | 'saving' | 'saved' | 'error'` と、記事の公開状態 `articleStatus: 'draft' | 'published'` を導入。`runSave(): Promise<string | null>`（既存 `enqueueSave` を包む薄いラッパ）。

- [ ] **Step 1: 失敗するテストを書く（戻る導線・ステータスバッジ・保存状態）**

`apps/web/src/pages/EditorPage.test.tsx` の `describe('EditorPage', ...)` 内に追加:

```tsx
  it('アクションバーに戻る導線と下書きステータスを出す', () => {
    renderNew();
    expect(screen.getByRole('link', { name: /戻る/ })).toBeInTheDocument();
    expect(screen.getByText('下書き')).toBeInTheDocument();
  });

  it('保存に成功すると保存状態インジケータが「保存しました」を示す', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-05T00:00:00Z' }) });
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }));
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument());
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/web test -- EditorPage`
Expected: 追加 2 件が FAIL（戻るリンク・「下書き」バッジが無い）

- [ ] **Step 3: 既存記事ロードで status を保持**

`EditorPage.tsx` に state を追加:

```tsx
  const [articleStatus, setArticleStatus] = useState<'draft' | 'published'>('draft');
```

既存記事ロードの `useEffect` 内、`setHeroImageUploadId(...)` の近くに追加:

```tsx
      setArticleStatus(a.status ?? 'draft');
```

- [ ] **Step 4: 保存状態インジケータ用の派生 state とラッパを追加**

`EditorPage.tsx` に追加（既存 `enqueueSave` は無改変）:

```tsx
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function runSave(): Promise<string | null> {
    setSaveState('saving');
    try {
      const savedId = await enqueueSave();
      setSaveState(savedId ? 'saved' : 'idle');
      return savedId;
    } catch {
      setSaveState('error');
      return null;
    }
  }
```

自動保存デバウンスの `setTimeout(() => { void enqueueSave(); }, 2000)` を `void runSave()` に、「下書き保存」ボタンの `onClick={enqueueSave}` を `onClick={runSave}` に変更。`publish` 内の `await enqueueSave()` はそのまま。保存成功時は既存の `setStatus('保存しました')` が出る。

- [ ] **Step 5: レイアウトを sticky アクションバー＋キャンバスに再構成**

`return (...)`（`loadFailed` 分岐の後）を次の構造に置き換える。**リッチ/Markdown 切替・RichEditor・ソースモードの CodeMirror ラッパー（`overflow-hidden rounded-lg border`）・プレビュー・エラー/ステータス表示・カテゴリ/タグ入力は現状のまま本文キャンバスに残す**（Task 6 でカテゴリ/タグを公開パネルへ移動）。旧フッターの「下書き保存」「公開する」ボタン群（`<div className="flex gap-2">...</div>`）は**削除**（アクションバーへ移動、二重にしない）。

```tsx
  const savingLabel =
    saveState === 'saving' ? '保存中…' :
    saveState === 'error' ? '保存に失敗' :
    status ? status :
    updatedAt ? '保存済み' : '未保存';

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b bg-background/85 px-4 py-2.5 backdrop-blur md:-mx-6 md:px-6">
        <Link to={id ? `/articles/${id}` : '/'} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />戻る
        </Link>
        <Badge variant={articleStatus === 'published' ? 'default' : 'secondary'}>
          {articleStatus === 'published' ? '公開済み' : '下書き'}
        </Badge>
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">{savingLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={runSave}>下書き保存</Button>
          <Button type="button" size="sm" onClick={publish}>公開する</Button>
        </div>
      </div>

      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-6">
        <div className="grid gap-1.5">
          <Label htmlFor="editor-title" className="sr-only">タイトル</Label>
          <input
            id="editor-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="タイトルを入力"
            className="w-full border-none bg-transparent text-3xl font-bold leading-snug tracking-tight outline-none placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>ヒーロー画像</Label>
          <HeroImageInput value={heroImageUploadId} onChange={setHeroImageUploadId} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="editor-category">カテゴリ</Label>
          <CategorySelect id="editor-category" value={categoryId} onChange={setCategoryId} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="editor-tags">タグ</Label>
          <TagInput id="editor-tags" value={tags} onChange={setTags} />
        </div>

        {/* 既存のモード切替 nav / richGuard / RichEditor / ソースモード /
            error / status を現状どおりここに残す（旧フッターボタンのみ削除） */}
      </section>
    </div>
  );
```

import に追加（`react-router` の既存 import に `Link` を足す。既に `useNavigate, useParams` を import 済み）:

```tsx
import { useNavigate, useParams, Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
```

注意:
- タイトルは `<Label className="sr-only">タイトル</Label>` を残すので `getByLabelText('タイトル')` は維持。旧 `<Input>` から素の `<input>` に変わるが型・値・onChange は同じ。
- モード切替 nav（`{ name: 'リッチ' }` / `{ name: 'Markdown' }`）、ソースモードラッパー（`overflow-hidden rounded-lg border`）、プレビュー（`aria-label="プレビュー"`）はそのまま。

- [ ] **Step 6: 追加テスト＋既存テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/web test -- EditorPage`
Expected: PASS（追加 2 件＋既存。「公開する」は依然として直 publish なので既存公開テストも緑）

- [ ] **Step 7: 型確認**

Run: `pnpm --filter @knowledge-hub/web typecheck`
Expected: エラーなし

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/EditorPage.tsx apps/web/src/pages/EditorPage.test.tsx
git commit -m "feat(web): add sticky action bar and heading title to editor"
```

---

### Task 6: EditorPage — 公開パネル（カテゴリ/タグ集約・必須ガード・公開/更新ラベル）

**Files:**
- Modify: `apps/web/src/pages/EditorPage.tsx`
- Test: `apps/web/src/pages/EditorPage.test.tsx`（公開系を新フローへ書き換え）

**Interfaces:**
- Consumes: Task 5 のアクションバー・`articleStatus`・`runSave`・`publish`。`CategorySelect`（`{ id?, value, onChange }`）, `TagInput`（`{ id?, value, onChange }`）, radix `Dialog`/`VisuallyHidden`。
- Produces: 「公開する」ボタンは公開パネル（Dialog）を開くトリガー。パネル内の公開実行ボタンが `publish` を呼ぶ。カテゴリ未選択時はパネルの公開ボタンを `disabled`＋警告。公開済み記事編集時はトリガー/実行ボタンのラベルを「更新を公開」に。新規 state `publishOpen: boolean`、派生 `publishLabel: string`。

- [ ] **Step 1: 公開系の既存テストを新フローへ書き換える**

`apps/web/src/pages/EditorPage.test.tsx`:

まず `@testing-library/react` の import に `within` を追加:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
```

冒頭の `vi.mock('../api/client', ...)` の `categories` を項目ありに変更:

```tsx
      categories: { $get: vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'c1', name: 'エンジニアリング' }] }) },
```

既存の 2 つの公開テスト（'新規記事を公開すると...' と '既存記事を公開すると...'）を削除し、次の 3 テストに置き換える:

```tsx
  it('新規記事は「公開する」で公開パネルを開き、カテゴリ選択後に公開できる', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-05T00:00:00Z' }) });
    publishMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '公開する' })); // パネルを開く
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/カテゴリ/), 'c1');
    await userEvent.click(within(dialog).getByRole('button', { name: '公開する' }));
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith({ param: { id: 'a1' } }));
    expect(navigateMock).toHaveBeenCalledWith('/articles/a1');
  });

  it('公開パネルはカテゴリ未選択だと公開実行ボタンが無効', async () => {
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '公開する' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '公開する' })).toBeDisabled();
    expect(within(dialog).getByText(/カテゴリの選択が必要/)).toBeInTheDocument();
  });

  it('公開済み記事の編集では公開トリガーが「更新を公開」になる', async () => {
    getMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'a1', title: '既存記事', bodyMd: '本文', categoryId: 'c1', tags: [], updatedAt: '2026-07-05T00:00:00Z', status: 'published' }),
    });
    renderEdit('a1');
    await screen.findByDisplayValue('既存記事');
    expect(screen.getByRole('button', { name: '更新を公開' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/web test -- EditorPage`
Expected: FAIL（公開パネル未実装）

- [ ] **Step 3: 公開パネルの state とラベルを追加**

`EditorPage.tsx` に追加:

```tsx
  const [publishOpen, setPublishOpen] = useState(false);
  const publishLabel = articleStatus === 'published' ? '更新を公開' : '公開する';
```

- [ ] **Step 4: キャンバスからカテゴリ/タグ入力を撤去**

Task 5 で残していたキャンバス内の `カテゴリ`（CategorySelect）と `タグ`（TagInput）の 2 ブロック（`<div className="grid gap-1.5">...</div>`）を**削除**する。公開パネルへ移す。

- [ ] **Step 5: アクションバーの「公開する」をパネルトリガーにし、公開パネルを実装**

アクションバーの公開ボタンを差し替え:

```tsx
          <Button type="button" size="sm" onClick={() => setPublishOpen(true)}>{publishLabel}</Button>
```

最上位 `<div className="flex flex-col">` の末尾（`</section>` の後、閉じ `</div>` の前）に公開パネルを追加:

```tsx
      <Dialog.Root open={publishOpen} onOpenChange={setPublishOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            aria-label="公開設定"
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col gap-5 border-l bg-card p-6 shadow-xl focus:outline-none"
          >
            <Dialog.Title className="text-base font-bold">公開設定</Dialog.Title>
            <VisuallyHidden.Root asChild>
              <Dialog.Description>記事のカテゴリとタグを設定して公開します</Dialog.Description>
            </VisuallyHidden.Root>
            <div className="grid gap-1.5">
              <Label htmlFor="publish-category">カテゴリ<span className="ml-1 text-destructive">*必須</span></Label>
              <CategorySelect id="publish-category" value={categoryId} onChange={setCategoryId} />
              {!categoryId && <p className="text-xs text-destructive">公開にはカテゴリの選択が必要です</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="publish-tags">タグ（任意）</Label>
              <TagInput id="publish-tags" value={tags} onChange={setTags} />
            </div>
            <div className="mt-auto grid gap-2">
              <Button
                type="button"
                disabled={!categoryId}
                onClick={async () => { setPublishOpen(false); await publish(); }}
              >
                {publishLabel}
              </Button>
              <p className="text-center text-xs text-muted-foreground">公開すると一覧・フィードに表示されます</p>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
```

import に追加:

```tsx
import { Dialog, VisuallyHidden } from 'radix-ui';
```

注意:
- `CategorySelect` の `<select>` は `<Label htmlFor="publish-category">` と `id="publish-category"` で関連付くため `within(dialog).getByLabelText(/カテゴリ/)` で解決する（Label 文言に `*必須` を含むので部分一致 `/カテゴリ/` を使う）。
- `publish` は既存関数（保存フラッシュ→publish→navigate）。パネルを閉じてから呼ぶ。

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/web test -- EditorPage`
Expected: PASS（公開パネル 3 件＋既存の保存/変換/D&D テスト）

- [ ] **Step 7: 型・コントラスト確認**

Run: `pnpm --filter @knowledge-hub/web typecheck && pnpm --filter @knowledge-hub/web check:contrast`
Expected: いずれもエラー/違反なし

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/EditorPage.tsx apps/web/src/pages/EditorPage.test.tsx
git commit -m "feat(web): move category/tag into publish panel with required-category guard"
```

---

## 最終確認（全タスク後・レビュー前）

- [ ] `pnpm run verify` を実行し全緑（shared/server/web の test＋`check:contrast`＋build＋typecheck）
- [ ] Playwright で実アプリの After 検証（`/articles/new`・既存記事編集・記事詳細ヒーロー・一覧サムネ 4:3・ダーク・モバイル幅）。scratchpad の `editor-shot.mjs` を流用。
- [ ] 最終ホールブランチレビュー（fable）→ fix wave → 再レビュー → `--no-ff` で main へマージ（tree 同一性検証）。push は user 判断（**しない**）。

## Self-Review（計画 vs spec）

- **§3 表示比率**: ヒーロー 16:9 contain＋ぼかし＝Task 2/3/4、サムネ 4:3 cover＝Task 1。✓
- **§4 レイアウト / §5 アクションバー**: Task 5。✓
- **§6 ヒーロー未設定コンパクト/設定時**: Task 4。共通表示＝Task 2。詳細統一＝Task 3。✓
- **§7 公開パネル・カテゴリ必須ガード**: Task 6（サーバー必須は既存、クライアント先回り無効化）。✓
- **§8 サムネ 4:3**: Task 1。✓
- **§9 保存状態可視化**: Task 5（`saveState`＋`savingLabel`、既存 `enqueueSave` 無改変ラッパ `runSave`）。✓
- **§10 既存機能維持**: リッチ/Markdown・損失ガード・D&D・直列化は各タスクで無改変。✓
- **§11 a11y**: label sr-only（タイトル）、role=status、Dialog（focus trap/Esc/aria-label）、背景 img aria-hidden。✓
- **型整合**: `HeroImage({src,alt,className})` は Task 2 定義＝Task 3/4 消費で一致。`runSave(): Promise<string|null>`、`saveState`/`articleStatus`/`publishLabel`/`publishOpen` は Task 5→6 で一貫。✓
- **プレースホルダ走査**: TBD/TODO なし。各コード step に実コードあり。✓
