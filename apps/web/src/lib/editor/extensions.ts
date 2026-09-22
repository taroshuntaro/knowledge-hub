import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
// v3 で行・ヘッダ・セルは @tiptap/extension-table に統合され、default export も無くなった。
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';

const lowlight = createLowlight(common);

/**
 * v3 の `Editor['storage']` は各拡張がモジュール拡張で宣言する方式に変わったため
 * （v2 では any だったので宣言不要だった）、tiptap-markdown が載せる storage を
 * ここで宣言する。型は 0.9.0 が同梱する MarkdownStorage をそのまま使う。
 */
declare module '@tiptap/core' {
  interface Storage {
    markdown: MarkdownStorage;
  }
}

/**
 * 同梱の MarkdownNodeSpec は node を汎用の ProseMirror Node として型付けするため
 * attrs が未知のままになる。Image の attrs はライブラリ側が知り得ないので、
 * シリアライザのカスタム実装で使う最小限の形だけをここでローカルに定義する。
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
 * tiptap-markdown 0.9.x の内蔵 MarkdownTightLists は listTypes: ['bulletList', 'orderedList']
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
    // v3 の StarterKit は link / underline / trailingNode を内蔵するようになった。
    // link は下の Link.configure を活かすため、underline は §6 の対象外記法
    // （Markdown へ serialize できず往復が壊れる）ため無効化する。
    // trailingNode は末尾が段落以外（コードブロック・テーブル等）の文書を
    // クリックしただけで段落を足して update を発火させる。記事を開いてクリック
    // しただけで onChangeMarkdown → 自動保存の PATCH が走り、updatedAt が進んで
    // 同時編集者が 409 を受けうるため（EditorPage の skipAutosaveRef は読み込み時
    // しか効かない）、v2 と同じ挙動になるよう無効化する。
    link: false,
    underline: false,
    trailingNode: false,
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
