import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  ChevronDown,
  Code,
  Code2,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Strikethrough,
  Table as TableIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { UploadImageFn } from './RichEditor';

/** リンクの href として許可するのは https?:// か / 始まりのみ（設計 §6）。 */
function isAllowedHref(href: string): boolean {
  return /^https?:\/\//.test(href) || href.startsWith('/');
}

const BLOCK_LABELS = {
  paragraph: '本文',
  heading1: '見出し1',
  heading2: '見出し2',
  heading3: '見出し3',
} as const;

/**
 * 設計 §6 の対応記法サブセットに 1:1 対応するツールバー。
 * この構成表に無いボタンは追加しない。
 */
export function RichEditorToolbar({
  editor,
  onUploadImage,
}: {
  editor: Editor;
  onUploadImage?: UploadImageFn;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      blockType: editor.isActive('heading', { level: 1 })
        ? 'heading1'
        : editor.isActive('heading', { level: 2 })
          ? 'heading2'
          : editor.isActive('heading', { level: 3 })
            ? 'heading3'
            : 'paragraph',
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      strike: editor.isActive('strike'),
      code: editor.isActive('code'),
      link: editor.isActive('link'),
      linkHref: (editor.getAttributes('link').href as string | undefined) ?? '',
      bulletList: editor.isActive('bulletList'),
      orderedList: editor.isActive('orderedList'),
      taskList: editor.isActive('taskList'),
      blockquote: editor.isActive('blockquote'),
      codeBlock: editor.isActive('codeBlock'),
      inTable: editor.isActive('table'),
    }),
  });

  const openLinkPopover = (open: boolean) => {
    if (open) setLinkValue(state.linkHref);
    setLinkOpen(open);
  };

  const applyLink = () => {
    if (!isAllowedHref(linkValue)) return;
    editor.chain().focus().setLink({ href: linkValue }).run();
    setLinkOpen(false);
  };

  const removeLink = () => {
    editor.chain().focus().unsetLink().run();
    setLinkOpen(false);
  };

  const handleImageButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onUploadImage) return;
    const { url } = await onUploadImage(file);
    editor.chain().focus().setImage({ src: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1">
      {/* ブロック種別 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="ブロック種別">
            {BLOCK_LABELS[state.blockType as keyof typeof BLOCK_LABELS]}
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
            本文
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            見出し1
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            見出し2
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            見出し3
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="mx-0.5 h-6" />

      {/* インライン */}
      <Toggle
        size="sm"
        aria-label="太字"
        pressed={state.bold}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-4" />
      </Toggle>
      <Toggle
        size="sm"
        aria-label="斜体"
        pressed={state.italic}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-4" />
      </Toggle>
      <Toggle
        size="sm"
        aria-label="打消し"
        pressed={state.strike}
        onPressedChange={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-4" />
      </Toggle>
      <Toggle
        size="sm"
        aria-label="コード"
        pressed={state.code}
        onPressedChange={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="size-4" />
      </Toggle>

      <Separator orientation="vertical" className="mx-0.5 h-6" />

      {/* リンク */}
      <Popover open={linkOpen} onOpenChange={openLinkPopover}>
        <PopoverTrigger asChild>
          <Toggle size="sm" aria-label="リンク" pressed={state.link}>
            <LinkIcon className="size-4" />
          </Toggle>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <div className="flex flex-col gap-2">
            <Input
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              placeholder="https://example.com または /path"
              aria-label="リンクURL"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={removeLink}
                disabled={!state.link}
              >
                解除
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={applyLink}
                disabled={!isAllowedHref(linkValue)}
              >
                設定
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* 画像 */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="画像を挿入"
        disabled={!onUploadImage}
        onClick={handleImageButtonClick}
      >
        <ImageIcon className="size-4" />
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileChange}
      />

      <Separator orientation="vertical" className="mx-0.5 h-6" />

      {/* リスト */}
      <Toggle
        size="sm"
        aria-label="箇条書き"
        pressed={state.bulletList}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-4" />
      </Toggle>
      <Toggle
        size="sm"
        aria-label="番号付き"
        pressed={state.orderedList}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" />
      </Toggle>
      <Toggle
        size="sm"
        aria-label="タスク"
        pressed={state.taskList}
        onPressedChange={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo className="size-4" />
      </Toggle>

      <Separator orientation="vertical" className="mx-0.5 h-6" />

      {/* ブロック */}
      <Toggle
        size="sm"
        aria-label="引用"
        pressed={state.blockquote}
        onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-4" />
      </Toggle>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="水平線"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus className="size-4" />
      </Button>
      <Toggle
        size="sm"
        aria-label="コードブロック"
        pressed={state.codeBlock}
        onPressedChange={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="size-4" />
      </Toggle>

      <Separator orientation="vertical" className="mx-0.5 h-6" />

      {/* テーブル */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="テーブル">
            <TableIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
          >
            表を挿入 3×3
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!state.inTable}
            onSelect={() => editor.chain().focus().addRowAfter().run()}
          >
            行を追加
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!state.inTable}
            onSelect={() => editor.chain().focus().addColumnAfter().run()}
          >
            列を追加
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!state.inTable}
            onSelect={() => editor.chain().focus().deleteRow().run()}
          >
            行を削除
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!state.inTable}
            onSelect={() => editor.chain().focus().deleteColumn().run()}
          >
            列を削除
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!state.inTable}
            onSelect={() => editor.chain().focus().deleteTable().run()}
          >
            表を削除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
