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
  // breaks: false のため、blockquote 内の隣接行は同一段落内のソフト改行として扱われ、
  // マージされる。往復後は改行ではなく半角スペース区切りの単一行になるのが正準形
  // （ハード改行が必要な場合は明示的な空行で段落を分ける）。
  引用: '> 引用文の一行目 二行目',
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

  it('引用: 隣接する行は 1 行にマージされる（CommonMark の同一段落内ソフト改行）', () => {
    // breaks: false のため、blockquote 内で空行を挟まない隣接行は同一段落として
    // マージされ、ソフト改行はスペースになる（<br> にはならない）。
    expect(roundTrip('> 引用文の一行目\n> 二行目').trimEnd()).toBe('> 引用文の一行目 二行目');
  });

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
