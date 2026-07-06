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
