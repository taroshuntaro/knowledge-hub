import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from './extensions';

/**
 * 記事を「開いてクリックしただけ」で update が発火してはいけない。
 * 発火すると RichEditor の onChangeMarkdown → EditorPage の自動保存が走り、
 * 編集していないのに updatedAt が進んで同時編集者が 409 を受ける
 * （EditorPage の skipAutosaveRef は読み込み時の state 反映しか抑止できない）。
 * v3 の StarterKit が内蔵する trailingNode は、末尾が段落以外の文書で
 * まさにこれを起こすため無効化している。
 */
describe('editorExtensions: 開いてクリックしただけでは update を発火しない', () => {
  it.each([
    ['コードブロックで終わる', '```\nx\n```'],
    ['テーブルで終わる', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['箇条書きで終わる', '- a\n- b'],
    ['段落で終わる', 'hello'],
  ])('%s', (_name, md) => {
    const onUpdate = vi.fn();
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: md,
      onUpdate,
    });
    try {
      editor.commands.focus('end');
      expect(onUpdate).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
    }
  });
});
