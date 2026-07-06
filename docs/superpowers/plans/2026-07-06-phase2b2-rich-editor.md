# Phase 2b-2: Tiptap リッチエディタ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 切替式エディタ（リッチ Tiptap ⇔ Markdown ソース + プレビュー）を Markdown 無損失往復を最優先に実装し、画像 D&D/ペーストと積み残し（uploads bodyLimit・自動保存直列化）を解消する。

**Architecture:** 保存形式は常に Markdown（`bodyMd` が単一のソース・オブ・トゥルース）。リッチモードは「Markdown をパースして編集し、Markdown にシリアライズして戻すビュー」であり、変換は `lib/editor/markdown-bridge.ts` に集約する。往復の無損失性は §6 全記法を網羅する専用テストスイートで機械検証し、無損失にできない Markdown ではリッチモードへの切替をガードする。UI は 2b-1 のデザインシステム（トークン + shadcn/ui）の上に構築する。

**Tech Stack:** Tiptap v2 系 + tiptap-markdown（markdown-it / prosemirror-markdown ベース）、@tiptap/extension-code-block-lowlight + lowlight、rehype-highlight（ビューア/プレビュー）、hono/body-limit

**Spec:**
- エディタ挙動の正: `docs/superpowers/specs/2026-07-04-knowledge-hub-design.md` §6
- エディタ UI・デザイン: `docs/superpowers/specs/2026-07-05-phase2b-design-refresh-editor-design.md`

## Global Constraints

- **対応記法は §6 の列挙に限定**: 見出し h1〜h3 / 段落 / 太字・斜体・打消し・インラインコード / リンク / 画像 / 箇条書き・番号付き・タスクリスト / 引用 / 水平線 / コードブロック（言語指定 + ハイライト）/ GFM テーブル。リッチモードのツールバーもこの範囲のみ提供する。
- **生 HTML は入力・保存とも許可しない**（tiptap-markdown は `html: false`。ツールバーに HTML 挿入手段を作らない）。
- **保存形式は常に Markdown**。リッチモードの編集内容は必ず `bodyMd`（string）に同期され、既存の自動保存（2 秒デバウンス）・楽観ロック・publish のロジックは変更しない。
- **無損失往復が最優先**: `serialize(parse(md)) === md` を §6 全記法の正準フィクスチャで検証するスイート（Task 1）が常に green であること。無損失でない Markdown ではリッチモード切替を警告付きでガードする。
- 既存テスト（EditorPage 3 件を含む全 19 件）は無修正で green を維持する（`getByLabelText('タイトル')` 等を壊さない）。
- 色はデザイントークンのみ（生の色コード直書き禁止。例外: `components/ui/` 生成物）。shadcn コンポーネント追加は CLI で行う。
- サーバー変更は uploads への bodyLimit 追加のみ（API の形状・レスポンスは不変）。
- 各タスク完了時に `pnpm --filter @knowledge-hub/web test` と `pnpm --filter @knowledge-hub/web typecheck` が green（サーバーを触るタスクは `pnpm --filter @knowledge-hub/server test` も）。
- **ライブラリ前提はスパイクで検証**（Task 1）: tiptap-markdown がテーブル/タスクリストを無損失往復できない場合は回避策を自作せず BLOCKED として報告し、判断を仰ぐ。

## File Structure

```
apps/web/src/
  lib/editor/
    extensions.ts          # §6 サブセットに限定した Tiptap 拡張セット
    markdown-bridge.ts     # md ⇔ doc 変換・roundTrip・isLossless（変換の唯一の入口）
    markdown-bridge.test.ts# §6 全記法の往復フィクスチャスイート
  lib/upload.ts            # 画像アップロード共通ヘルパ（+ .test.ts）
  components/editor/
    RichEditor.tsx          # Tiptap 本体（EditorContent + onChangeMarkdown）
    RichEditorToolbar.tsx   # ツールバー（shadcn Toggle/DropdownMenu/Popover）
    RichEditor.test.tsx
  pages/EditorPage.tsx      # モード切替タブ・プレビュー統合（ロジックは維持）
  lib/markdown.tsx          # ビューア: ハイライト + タスクリスト表示対応
  lib/markdown.test.tsx     # 追記
  index.css                 # エディタ面・hljs のトークン連動スタイル
apps/server/src/routes/uploads.ts       # bodyLimit 前置
apps/server/src/routes/uploads.test.ts  # 413 ケース追記
```

## モデル・スキル指定

- Task 1（スパイク）と Task 3（モード切替統合）は判断を要するため標準以上のモデルを推奨。Task 2（ツールバー）は分量が多いが仕様は明確。他は計画どおりの転写が中心。
- ツールバー・切替 UI の見た目は 2b-1 のトークン・パターン（segmented tabs 等）を踏襲する。新たなデザイン創作は不要（frontend-design 不要）。

---

### Task 1: 依存導入 + markdown-bridge + 無損失往復スイート（スパイク）

このフェーズの技術リスク（往復無損失）を最初に潰す。**フィクスチャが定義する正準形が以後のプロジェクトの正**となる。

**Files:**
- Modify: `apps/web/package.json`（依存追加）
- Create: `apps/web/src/lib/editor/extensions.ts`
- Create: `apps/web/src/lib/editor/markdown-bridge.ts`
- Create: `apps/web/src/lib/editor/markdown-bridge.test.ts`

**Interfaces:**
- Produces: `editorExtensions: Extensions`（Task 2 が使用）、`markdownToDoc(md: string): JSONContent`、`docToMarkdown(doc: JSONContent): string`、`roundTrip(md: string): string`、`isLossless(md: string): boolean`（Task 3 が使用）

- [ ] **Step 1: 依存を追加（Tiptap v2 系に固定）**

```bash
pnpm --filter @knowledge-hub/web add @tiptap/react@^2 @tiptap/core@^2 @tiptap/pm@^2 @tiptap/starter-kit@^2 @tiptap/extension-link@^2 @tiptap/extension-image@^2 @tiptap/extension-task-list@^2 @tiptap/extension-task-item@^2 @tiptap/extension-table@^2 @tiptap/extension-table-row@^2 @tiptap/extension-table-header@^2 @tiptap/extension-table-cell@^2 @tiptap/extension-code-block-lowlight@^2 lowlight tiptap-markdown
```

- [ ] **Step 2: extensions.ts を作成**

```ts
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Markdown } from 'tiptap-markdown';

const lowlight = createLowlight(common);

/**
 * 設計 §6 の対応記法に限定した拡張セット。
 * ここに無い記法（下線・文字色・生 HTML 等）はリッチモードでは提供しない。
 * Markdown 拡張の設定値が「正準 Markdown」の形を決める（markdown-bridge のフィクスチャと一致させる）。
 */
export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false, // CodeBlockLowlight に置き換え
  }),
  Link.configure({ openOnClick: false }),
  Image,
  TaskList,
  TaskItem.configure({ nested: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  CodeBlockLowlight.configure({ lowlight }),
  Markdown.configure({
    html: false, // 生 HTML は入力・保存とも許可しない（設計 §6）
    bulletListMarker: '-',
    linkify: false,
    breaks: false,
    transformPastedText: true,
  }),
];
```

- [ ] **Step 3: markdown-bridge.ts を作成**

```ts
import { Editor, type JSONContent } from '@tiptap/core';
import { editorExtensions } from './extensions';

/**
 * Markdown ⇔ Tiptap doc 変換の唯一の入口。
 * 「正準 Markdown」= このモジュールの roundTrip が不動点とする形
 * （ATX 見出し・箇条書きマーカー "-"・フェンス ``` など。詳細はテストのフィクスチャ）。
 */
function withHeadlessEditor<T>(fn: (editor: Editor) => T, content?: string): T {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: content ?? '',
  });
  try {
    return fn(editor);
  } finally {
    editor.destroy();
  }
}

export function markdownToDoc(md: string): JSONContent {
  return withHeadlessEditor((e) => e.getJSON(), md);
}

export function docToMarkdown(doc: JSONContent): string {
  return withHeadlessEditor((e) => {
    e.commands.setContent(doc);
    return e.storage.markdown.getMarkdown();
  });
}

export function roundTrip(md: string): string {
  return withHeadlessEditor((e) => e.storage.markdown.getMarkdown(), md);
}

/** 正準形どうしの比較。末尾改行の揺れだけは吸収する */
export function isLossless(md: string): boolean {
  return roundTrip(md).trimEnd() === md.trimEnd();
}
```

- [ ] **Step 4: 往復フィクスチャスイートを書く（§6 全記法を網羅）**

`markdown-bridge.test.ts`。**各フィクスチャは正準形**（このスイートが green になる形が正準）。

```ts
import { describe, expect, it } from 'vitest';
import { isLossless, roundTrip } from './markdown-bridge';

// 設計 §6 の対応記法を 1 つずつ + 複合ドキュメントで往復検証する
const FIXTURES: Record<string, string> = {
  見出し: '# 見出し1\n\n## 見出し2\n\n### 見出し3',
  段落: '一つ目の段落。\n\n二つ目の段落。',
  インライン装飾: '**太字**と*斜体*と~~打消し~~と`code`を含む段落。',
  リンク: '[knowledge-hub](https://example.com/docs)',
  画像: '![スクリーンショット](/api/uploads/123e4567-e89b-12d3-a456-426614174000)',
  箇条書き: '- 項目1\n- 項目2\n  - 入れ子',
  番号付きリスト: '1. 手順1\n2. 手順2',
  タスクリスト: '- [ ] 未完了\n- [x] 完了',
  引用: '> 引用文の一行目\n> 二行目',
  水平線: '前の段落\n\n---\n\n次の段落',
  コードブロック: '```ts\nconst x: number = 1;\nconsole.log(x);\n```',
  テーブル: '| 列A | 列B |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |',
};

describe('markdown-bridge 往復（§6 全記法）', () => {
  for (const [name, md] of Object.entries(FIXTURES)) {
    it(`${name} が無損失で往復する`, () => {
      expect(roundTrip(md).trimEnd()).toBe(md.trimEnd());
    });
  }

  it('全記法を含む複合ドキュメントが無損失で往復する', () => {
    const doc = Object.values(FIXTURES).join('\n\n');
    expect(roundTrip(doc).trimEnd()).toBe(doc.trimEnd());
  });

  it('isLossless: 正準 Markdown は true', () => {
    expect(isLossless(FIXTURES['見出し'])).toBe(true);
  });

  it('isLossless: 生 HTML を含む Markdown は false（リッチ切替ガードの根拠）', () => {
    expect(isLossless('<div class="x">raw html</div>')).toBe(false);
  });
});
```

- [ ] **Step 5: スイートを実行し、差分を潰す（スパイク本体）**

Run: `pnpm --filter @knowledge-hub/web test -- src/lib/editor/markdown-bridge.test.ts`

失敗したフィクスチャごとに次の優先順で解消する:
1. `Markdown.configure` のオプション調整（マーカー・改行の扱い等）
2. シリアライザの正準形にフィクスチャ側を合わせる（例: テーブル区切りのスペーシング、入れ子リストのインデント幅）。**合わせた場合はフィクスチャがそのまま新しい正準形の宣言になる**ので、変更理由をテスト内コメントに残す
3. 上記で解決できない記法（特にテーブル・タスクリスト）が残る場合は**自作パッチで回避せず BLOCKED として報告**する

Expected: 最終的に全ケース PASS。

- [ ] **Step 6: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 既存 19 + 新規全て green

```bash
git add apps/web
git commit -m "feat(web): add tiptap markdown bridge with lossless round-trip suite"
```

---

### Task 2: RichEditor コンポーネント + ツールバー

**Files:**
- Create: `apps/web/src/components/editor/RichEditor.tsx`
- Create: `apps/web/src/components/editor/RichEditorToolbar.tsx`
- Create: `apps/web/src/components/editor/RichEditor.test.tsx`
- Modify: `apps/web/src/index.css`（`.tiptap` コンテンツ領域のスタイル）
- Create: `apps/web/src/components/ui/`（CLI: toggle, tooltip, dropdown-menu, popover）

**Interfaces:**
- Consumes: Task 1 の `editorExtensions`
- Produces: `<RichEditor initialMarkdown={string} onChangeMarkdown={(md: string) => void} onUploadImage={(file: File) => Promise<{ url: string }>} />`（Task 3 が使用。`onUploadImage` は Task 5 で配線されるまで省略可の optional prop）

- [ ] **Step 1: shadcn コンポーネントを追加**

```bash
cd apps/web
pnpm dlx shadcn@latest add toggle tooltip dropdown-menu popover --yes
```

- [ ] **Step 2: RichEditor.tsx を作成**

```tsx
import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { editorExtensions } from '@/lib/editor/extensions';
import { RichEditorToolbar } from './RichEditorToolbar';

export type UploadImageFn = (file: File) => Promise<{ url: string }>;

/**
 * Markdown を編集するリッチビュー。内容の正は常に Markdown 文字列で、
 * 変更は 500ms デバウンスでシリアライズして onChangeMarkdown に流す
 * （EditorPage 側の 2 秒自動保存デバウンスがその後段にある）。
 */
export function RichEditor({
  initialMarkdown,
  onChangeMarkdown,
  onUploadImage,
}: {
  initialMarkdown: string;
  onChangeMarkdown: (md: string) => void;
  onUploadImage?: UploadImageFn;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useEditor({
    extensions: editorExtensions,
    content: initialMarkdown,
    editorProps: {
      attributes: {
        class: 'tiptap prose max-w-none min-h-[420px] px-4 py-3 focus:outline-none',
        'aria-label': '本文（リッチエディタ）',
      },
    },
    onUpdate: ({ editor }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        onChangeMarkdown(editor.storage.markdown.getMarkdown());
      }, 500);
    },
  });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!editor) return null;
  return (
    <div className="overflow-hidden rounded-lg border focus-within:ring-2 focus-within:ring-ring">
      <RichEditorToolbar editor={editor} onUploadImage={onUploadImage} />
      <EditorContent editor={editor} />
    </div>
  );
}
```

- [ ] **Step 3: RichEditorToolbar.tsx を作成**

§6 のサブセットに 1:1 対応するボタン群。すべて日本語 `aria-label`、アクティブ状態は `Toggle` の `pressed`。以下の構成・コマンドで実装する（コードは長いため構成表で指定。**この表に無いボタンを追加しない**）:

| グループ | UI | コマンド / 状態 |
|---|---|---|
| ブロック種別 | DropdownMenu（本文 / 見出し1 / 見出し2 / 見出し3） | `setParagraph()` / `toggleHeading({ level })`、現在値をトリガーに表示 |
| インライン | Toggle ×4（太字・斜体・打消し・コード） | `toggleBold/Italic/Strike/Code`、`isActive('bold')` 等 |
| リンク | Popover（URL input + 「設定」「解除」ボタン） | `setLink({ href })` / `unsetLink()`。href は `https?://` か `/` 始まりのみ許可 |
| 画像 | Button + 非表示 `<input type="file" accept="image/*">` | `onUploadImage` があれば upload → `setImage({ src: url })`。無ければボタンを disabled |
| リスト | Toggle ×3（箇条書き・番号付き・タスク） | `toggleBulletList/OrderedList/TaskList` |
| ブロック | Toggle（引用）・Button（水平線）・Toggle（コードブロック） | `toggleBlockquote` / `setHorizontalRule` / `toggleCodeBlock` |
| テーブル | DropdownMenu（表を挿入 3×3 / 行を追加 / 列を追加 / 行を削除 / 列を削除 / 表を削除） | `insertTable({ rows: 3, cols: 3, withHeaderRow: true })` / `addRowAfter` / `addColumnAfter` / `deleteRow` / `deleteColumn` / `deleteTable`。表内でないとき操作系は disabled |

- レイアウト: `flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1`、グループ間に `Separator orientation="vertical"`。
- 再レンダー: `useEditorState`（@tiptap/react）または editor の `transaction` イベント購読で `isActive` を反映する。

- [ ] **Step 4: index.css に .tiptap のトークン連動スタイルを追記**

```css
/* リッチエディタのコンテンツ領域。prose と同じトークンで統一する */
.tiptap p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--muted-foreground);
  float: left;
  height: 0;
  pointer-events: none;
}
.tiptap table {
  border-collapse: collapse;
}
.tiptap th,
.tiptap td {
  border: 1px solid var(--border);
  padding: 0.375rem 0.625rem;
}
.tiptap .selectedCell {
  background-color: var(--accent);
}
```

- [ ] **Step 5: スモークテストを書く**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RichEditor } from './RichEditor';

describe('RichEditor', () => {
  it('初期 Markdown をリッチ表示し、太字トグルで onChangeMarkdown に ** が流れる', async () => {
    const onChange = vi.fn();
    render(<RichEditor initialMarkdown="# 見出し\n\n本文" onChangeMarkdown={onChange} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('見出し');
    // 全選択 → 太字
    const content = screen.getByLabelText('本文（リッチエディタ）');
    await userEvent.click(content);
    await userEvent.keyboard('{Meta>}a{/Meta}');
    await userEvent.click(screen.getByRole('button', { name: '太字' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 2000 });
    expect(onChange.mock.calls.at(-1)![0]).toContain('**');
  });
});
```

jsdom で ProseMirror の一部 API（`getClientRects` 等）が未実装で警告・失敗する場合は、テストファイル冒頭で最小のスタブ（`Range.prototype.getClientRects` / `getBoundingClientRect`）を追加してよい（実装コードにはテスト都合の変更を入れない）。

- [ ] **Step 6: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`

```bash
git add apps/web
git commit -m "feat(web): add rich editor component with subset toolbar"
```

---

### Task 3: EditorPage モード切替統合

**Files:**
- Modify: `apps/web/src/pages/EditorPage.tsx`
- Modify: `apps/web/src/pages/EditorPage.test.tsx`（**追記のみ**。既存 3 テストは無修正）

**Interfaces:**
- Consumes: Task 1 の `isLossless` / `roundTrip`、Task 2 の `RichEditor`

**動作仕様:**
- モード state: `'rich' | 'source'`。**新規記事はリッチが初期値**。既存記事は読み込んだ `bodyMd` が `isLossless` ならリッチ、そうでなければソースで開き通知を出す。
- タブ UI は MyArticlesPage と同じ segmented パターン（`aria-pressed` 付き button、ラベル「リッチ」「Markdown」）。
- リッチ → ソース: `bodyMd` は常に同期済み（RichEditor の onChangeMarkdown）なのでそのまま切替。
- ソース → リッチ: `isLossless(bodyMd)` なら切替。そうでなければ `role="alert"` の警告パネルを表示し、「変換して続行」（`bodyMd = roundTrip(bodyMd)` して切替）と「キャンセル」を提供する。
- リッチモードでは `RichEditor` を、ソースモードでは既存の CodeMirror を表示。**save / publish / 自動保存 / 楽観ロックのロジックは 1 行も変えない**（リッチの変更も `setBodyMd` 経由で既存の自動保存 effect に乗る）。
- モード切替時に RichEditor を `key={リッチ切替回数}` で再マウントし、最新 `bodyMd` から `initialMarkdown` を与える（双方向バインドはしない。リッチ表示中の正はエディタ内部、ソース表示中の正は `bodyMd`）。

- [ ] **Step 1: 追加テストを書く（既存テストは触らない）**

```tsx
  it('新規記事はリッチモードで開き、Markdown タブでソースに切り替わる', async () => {
    renderNew();
    expect(screen.getByRole('button', { name: 'リッチ' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    expect(screen.getByRole('button', { name: 'Markdown' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('無損失でない本文ではソース → リッチ切替時に警告が出る', async () => {
    renderNew();
    await userEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    // CodeMirror に生 HTML を注入する代わりに、タイトル + bodyMd を直接編集できないため
    // ここでは isLossless をモックせず、リッチ切替ガードの分岐を EditorPage の
    // ヘルパ関数として切り出してユニットテストする（switchGuard(bodyMd) の戻り値検証）
  });
```

2 本目のように jsdom で CodeMirror への入力が困難な場合は、切替判定を純関数（例: `canEnterRich(bodyMd): { ok: true } | { ok: false; converted: string }`）として EditorPage から export し、それをユニットテストする形に落としてよい。

**重要**: 新規記事のデフォルトがリッチになるため、**既存の EditorPage テスト 3 件も ProseMirror をマウントするようになる**。jsdom の欠損 API（`Range.prototype.getClientRects` 等）でエラーになる場合、スタブは**個別テストではなく `src/test/setup.ts`（共有セットアップ）に追加**する。既存テストファイルの本文改変は不可、setup への追記は可。

- [ ] **Step 2: EditorPage を統合実装**

上記動作仕様どおり。タブ nav は:

```tsx
      <nav className="inline-flex rounded-lg bg-muted p-1" aria-label="編集モード">
        {/* リッチ / Markdown の 2 ボタン。MyArticlesPage と同じ aria-pressed パターン */}
      </nav>
```

- [ ] **Step 3: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 既存 3 テスト無修正で green + 追加テスト green

```bash
git add apps/web
git commit -m "feat(web): integrate rich/source mode switch with lossless guard"
```

---

### Task 4: ソースモードにプレビューを追加

**Files:**
- Modify: `apps/web/src/pages/EditorPage.tsx`

設計 §6 の「Markdown ソースモード（CodeMirror + プレビュー）」を実装する。

- [ ] **Step 1: ソースモードのレイアウトを 2 ペイン化**

```tsx
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border">
          <CodeMirror value={bodyMd} height="480px" theme={theme} extensions={[markdown()]} onChange={setBodyMd} />
        </div>
        <div className="max-h-[480px] overflow-y-auto rounded-lg border bg-card px-4 py-3" aria-label="プレビュー">
          <Markdown source={bodyMd} />
        </div>
      </div>
```

`Markdown` は既存の `@/lib/markdown`（ビューアと同一パイプライン = 見た目が本番と一致する）。エディタはデスクトップ優先（§7）なので、lg 未満は縦積みで良い。

- [ ] **Step 2: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`

```bash
git add apps/web
git commit -m "feat(web): add live preview pane to markdown source mode"
```

---

### Task 5: 画像アップロード共通ヘルパ + D&D / ペースト（両モード）

**Files:**
- Create: `apps/web/src/lib/upload.ts`
- Create: `apps/web/src/lib/upload.test.ts`
- Modify: `apps/web/src/components/editor/RichEditor.tsx`（handleDrop / handlePaste）
- Modify: `apps/web/src/pages/EditorPage.tsx`（ソースモードの D&D/ペースト + RichEditor への `onUploadImage` 配線）

**Interfaces:**
- Produces: `uploadImage(file: File): Promise<{ url: string }>`（失敗時は Error を throw、メッセージはサーバーの `message` を優先）

- [ ] **Step 1: upload.ts + テスト**

```ts
/** 画像を POST /api/uploads に送り、本文に挿入する URL を返す */
export async function uploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: form, credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? '画像のアップロードに失敗しました');
  }
  return (await res.json()) as { url: string };
}
```

テスト: fetch をモックし、(1) 成功で `{ url }` を返す (2) 失敗でサーバーの `message` を持つ Error を投げる、の 2 ケース。

- [ ] **Step 2: RichEditor に D&D / ペーストを配線**

`editorProps` に `handleDrop` / `handlePaste` を追加: `dataTransfer`（または clipboardData）の files に画像（`type.startsWith('image/')`）があれば、`onUploadImage(file)` → 解決後に `editor.chain().focus().setImage({ src: url }).run()`。アップロード中はツールバー画像ボタンを disabled にし、失敗時は `role="alert"` のエラー行に表示（onError prop を追加して EditorPage の `setError` に配線）。画像以外の drop/paste は既定動作に任せる（`false` を返す）。

- [ ] **Step 3: ソースモード（CodeMirror）に D&D / ペーストを配線**

CodeMirror ラッパー div の `onDrop` / `onPaste` で画像ファイルを検出したら `uploadImage` → `setBodyMd((prev) => prev + '\n\n![](URL)\n')` 形式でカーソル位置を問わず末尾に挿入（カーソル位置挿入は EditorView API が必要になるため v1 は末尾で良い。コメントで明記）。失敗時は既存の `setError` へ。

- [ ] **Step 4: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`

```bash
git add apps/web
git commit -m "feat(web): add image drag-drop and paste upload in both editor modes"
```

---

### Task 6: uploads に bodyLimit を前置（server・積み残し #3）

**Files:**
- Modify: `apps/server/src/routes/uploads.ts`
- Modify: `apps/server/src/routes/uploads.test.ts`（413 ケース追記）

現状はリクエスト全体を `await file.arrayBuffer()` でバッファしてから 10MB 判定しており、巨大ボディでメモリを食える。hono の `bodyLimit` をルート前段に置く。

- [ ] **Step 1: 413 テストを追記（RED）**

11MB 超の multipart ボディを POST し、`413` が返ることを検証（既存テストのセットアップ・Fake storage をそのまま使う）。

- [ ] **Step 2: bodyLimit を追加（GREEN）**

```ts
import { bodyLimit } from 'hono/body-limit';
```

```ts
  .post(
    '/',
    bodyLimit({
      maxSize: 11 * 1024 * 1024, // multipart のオーバーヘッド込みで 10MB 画像を通す
      onError: (c) => c.json({ code: 'VALIDATION', message: 'ファイルサイズが大きすぎます（上限10MB）' }, 413),
    }),
    async (c) => { /* 既存ハンドラ本体は不変 */ },
  )
```

既存のサービス層 10MB チェック（`upload-service.ts`）は**多層防御としてそのまま残す**。

- [ ] **Step 3: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`
Expected: 既存 112 + 追加分 green（Testcontainers 使用のため Docker 起動が前提）

```bash
git add apps/server
git commit -m "fix(server): enforce body limit before buffering uploads"
```

---

### Task 7: 自動保存の直列化ガード（積み残し #5）

**Files:**
- Modify: `apps/web/src/pages/EditorPage.tsx`
- Modify: `apps/web/src/pages/EditorPage.test.tsx`（追記のみ）

新規記事で POST が in-flight のままデバウンスをすり抜けて 2 発目の POST が走ると記事が重複作成される。保存をプロミスチェーンで直列化する。

- [ ] **Step 1: 重複 POST を再現するテストを書く（RED）**

前提: 2 回目の保存は id 確定後の PATCH になるため、テストファイル冒頭の `vi.mock('../api/client', ...)` に `patchMock` を追加する（`':id'` オブジェクトに `$patch: (...a: unknown[]) => patchMock(...a)` を足し、`ok: true` で解決させる。**既存テストの本文は変更しない**）。

```tsx
  it('保存が in-flight の間に再度保存しても記事は 1 つしか作られない', async () => {
    let resolveFirst!: (v: unknown) => void;
    postMock
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'a2', updatedAt: 'x' }) });
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'race');
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }));
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' })); // 1 発目が未解決のまま
    resolveFirst({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-06T00:00:00Z' }) });
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument());
    expect(postMock).toHaveBeenCalledTimes(1); // 2 回目は id 確定後なので PATCH になる（POST は 1 回）
  });
```

- [ ] **Step 2: 直列化を実装（GREEN）**

```tsx
  // 保存の直列化: 前の保存が完了してから次を実行する（新規作成 POST の重複防止）
  const saveChain = useRef<Promise<string | null>>(Promise.resolve(null));
  function enqueueSave(): Promise<string | null> {
    const next = saveChain.current.then(() => save());
    saveChain.current = next.catch(() => null);
    return next;
  }
```

自動保存 effect・「下書き保存」ボタン・`publish()` 内の `save()` 呼び出しをすべて `enqueueSave()` に置き換える（`save()` 本体のロジックは不変）。

- [ ] **Step 3: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 既存テスト無修正 green + 新テスト green

```bash
git add apps/web
git commit -m "fix(web): serialize editor saves to prevent duplicate drafts"
```

---

### Task 8: エディタ面のトークン整合（CodeMirror ダークの温色化）

**Files:**
- Modify: `apps/web/src/index.css`

2b-1 の申し送り: ダークテーマの CodeMirror（@uiw 組込み dark）が寒色系の青灰で、温かい背景から浮く。エディタ面の背景・ガター・選択色だけトークンで上書きし、シンタックス色は組込みテーマのまま使う。

- [ ] **Step 1: index.css に上書きを追記**

```css
/* CodeMirror の面をテーマトークンに合わせる（シンタックス色は theme prop のまま） */
.cm-editor {
  background-color: var(--card);
}
.cm-editor .cm-gutters {
  background-color: var(--muted);
  color: var(--muted-foreground);
  border-right: 1px solid var(--border);
}
.cm-editor .cm-activeLine,
.cm-editor .cm-activeLineGutter {
  background-color: color-mix(in oklch, var(--accent) 40%, transparent);
}
.cm-editor.cm-focused {
  outline: none;
}
```

- [ ] **Step 2: 目視確認（両テーマ）と Commit**

dev サーバーでライト/ダークを切り替え、ソースモードの文字色（組込みテーマのシンタックス色）が新しい背景の上で読めることを確認する（コントラストが崩れる場合は `.cm-editor` の上書きを background のみに縮小する）。

```bash
git add apps/web/src/index.css
git commit -m "style(web): align codemirror surfaces with theme tokens"
```

---

### Task 9: ビューア/プレビュー強化（コードハイライト + タスクリスト表示）

**Files:**
- Modify: `apps/web/src/lib/markdown.tsx`
- Modify: `apps/web/src/lib/markdown.test.tsx`（追記）
- Modify: `apps/web/src/index.css`（hljs トークン連動テーマ）
- Modify: `apps/web/package.json`（rehype-highlight 追加）

エディタ側がコードブロックをハイライトする（lowlight）ため、記事詳細・プレビューも同等に描画して一貫させる。あわせて GFM タスクリストのチェックボックスが sanitize で落ちる問題を解消する。

- [ ] **Step 1: テストを追記（RED）**

```tsx
  it('コードブロックがハイライトされる（hljs クラスが付く）', () => {
    render(<Markdown source={'```ts\nconst x = 1;\n```'} />);
    expect(document.querySelector('code.language-ts')).not.toBeNull();
    expect(document.querySelector('.hljs-keyword')).not.toBeNull();
  });

  it('タスクリストが無効化チェックボックスとして描画される', () => {
    render(<Markdown source={'- [x] done\n- [ ] todo'} />);
    const boxes = document.querySelectorAll('input[type="checkbox"][disabled]');
    expect(boxes).toHaveLength(2);
  });

  it('input は checkbox 以外を許可しない（XSS 面の回帰確認）', () => {
    render(<Markdown source={'<input type="text" value="x">'} />);
    expect(document.querySelector('input[type="text"]')).toBeNull();
  });
```

- [ ] **Step 2: 実装（GREEN）**

```bash
pnpm --filter @knowledge-hub/web add rehype-highlight
```

`markdown.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

// defaultSchema からの拡張は最小限に留める:
// - input: GFM タスクリストのチェックボックス表示のみ（checkbox + disabled + checked）
// ハイライトの span/class は sanitize の後段（rehype-highlight）が生成するため許可不要。
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'input'],
  attributes: {
    ...defaultSchema.attributes,
    // フェンスの言語クラスを明示的に許可（defaultSchema の内容に依存しない）
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
    input: [['type', 'checkbox'], 'checked', 'disabled'],
  },
};

export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], [rehypeHighlight, { detect: false }]]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
```

**順序が安全性の要**: sanitize は rehype-highlight の**前**。highlight が付与する class は自前生成なので信頼できる。`detect: false` で言語未指定のフェンスは推定しない。

`index.css` に hljs のトークン連動配色（ライト/ダーク両対応。`.dark` で変数が切り替わるので 1 定義で済むよう、必要なら専用の `--code-*` トークンを `:root`/`.dark` に追加してよい — その場合も check-contrast の対象ペアには含めなくてよいが、目視で両テーマの可読性を確認する）:

```css
/* コードハイライト（rehype-highlight / lowlight 共通の hljs クラス） */
.hljs-comment, .hljs-quote { color: var(--muted-foreground); font-style: italic; }
.hljs-keyword, .hljs-selector-tag { color: var(--accent-foreground); }
.hljs-string, .hljs-attr, .hljs-number, .hljs-literal { color: var(--primary); }
.hljs-title, .hljs-name, .hljs-built_in { color: var(--foreground); font-weight: 600; }
```

- [ ] **Step 3: 検証と Commit**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: 既存 XSS テスト（markdown.test.tsx の既存 2 件）が無修正で green のまま

```bash
git add apps/web
git commit -m "feat(web): highlight code blocks and render task lists in viewer"
```

---

### Task 10: 全体検証

**Files:** なし（検証のみ。問題が出たら該当タスクの流儀で修正）

- [ ] **Step 1: 全部入りの検証**

Run:
```bash
pnpm --filter @knowledge-hub/web test
pnpm --filter @knowledge-hub/web typecheck
pnpm --filter @knowledge-hub/web check:contrast
pnpm --filter @knowledge-hub/web build
pnpm --filter @knowledge-hub/server test
pnpm typecheck
```
Expected: すべて green / ok / クリーン

- [ ] **Step 2: Commit（残変更があれば）**

```bash
git status --short   # 想定外の未コミットが無いことを確認
```

---

## 完了後の検証（コントローラーが実施）

1. dev サーバー（API + MinIO + web）でブラウザ通し: リッチモードで §6 全記法を作成 → ソース切替で正準 Markdown を確認 → 公開 → 記事詳細でハイライト/タスクリスト表示 → 画像 D&D（MinIO 実往復）→ ダークテーマで一式再確認。
2. 生 HTML を含む記事（ソースで作成）でリッチ切替ガードの発火を確認。
3. 楽観ロック・自動保存が両モードで機能することを確認（2 タブ同時編集で 409）。
