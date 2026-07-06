import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
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
