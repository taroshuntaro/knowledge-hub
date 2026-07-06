import { Extension } from '@tiptap/core';
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
 * tiptap-markdown は型定義を同梱していないため、シリアライザのカスタム実装で
 * 使う最小限の形だけをここでローカルに定義する（ライブラリ内部実装の型と同義）。
 */
interface MarkdownSerializeState {
  write(text: string): void;
  esc(text: string): string;
  closeBlock(node: MarkdownSerializeNode): void;
}
interface MarkdownSerializeNode {
  attrs: { alt?: string | null; src: string; title?: string | null };
}

/**
 * tiptap-markdown 0.8.x の内蔵 MarkdownTightLists は listTypes: ['bulletList', 'orderedList']
 * のみを対象とし taskList を含まない。そのため taskList には tight 属性が一切付与されず、
 * prosemirror-markdown のシリアライザは tightLists のデフォルト(false)にフォールバックし、
 * 各タスク項目の間に空行を挟んでしまう（往復不能）。
 * MarkdownTightLists と同じ判定ロジック（data-tight 属性 or 子要素に <p> が無ければ tight）を
 * taskList にも適用し、通常の箇条書きと同様にタイトなリストとして扱う。
 */
const TaskListTight = Extension.create({
  name: 'taskListTight',
  addGlobalAttributes() {
    return [
      {
        types: ['taskList'],
        attributes: {
          tight: {
            default: true,
            parseHTML: (element) =>
              element.getAttribute('data-tight') === 'true' || !element.querySelector('p'),
            renderHTML: (attributes) => ({
              class: attributes.tight ? 'tight' : null,
              'data-tight': attributes.tight ? 'true' : null,
            }),
          },
        },
      },
    ];
  },
});

/**
 * @tiptap/extension-image は image を group: 'block' のノードとして定義するため、
 * 段落に包まれず doc 直下に単独のブロックとして現れる。しかし tiptap-markdown の
 * defaultMarkdownSerializer.nodes.image はインライン画像を想定しており closeBlock() を
 * 呼ばない。そのため直後に続くノード（リスト等）との間に区切り（空行）が入らず、
 * 生成物が単一行に結合されてしまい往復できない（例: "![alt](/x)- a"）。
 * ブロック画像として closeBlock() を追加したシリアライザに差し替える。
 */
const ImageBlock = Image.extend({
  addStorage() {
    return {
      markdown: {
        // tiptap-markdown は型定義を同梱しないため、他ノード実装（task-item.js 等）に
        // 合わせて state/node は any 相当で扱う。
        serialize(state: MarkdownSerializeState, node: MarkdownSerializeNode) {
          state.write(
            '![' +
              state.esc(node.attrs.alt || '') +
              '](' +
              node.attrs.src.replace(/[()]/g, '\\$&') +
              (node.attrs.title ? ' "' + node.attrs.title.replace(/"/g, '\\"') + '"' : '') +
              ')',
          );
          state.closeBlock(node);
        },
        parse: {
          // markdown-it が処理する
        },
      },
    };
  },
});

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
  ImageBlock,
  TaskList,
  TaskItem.configure({ nested: false }),
  TaskListTight,
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
