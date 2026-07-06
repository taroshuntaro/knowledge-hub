import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { editorExtensions } from '@/lib/editor/extensions';
import { firstImageFile } from '@/lib/upload';
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
  onError,
}: {
  initialMarkdown: string;
  onChangeMarkdown: (md: string) => void;
  onUploadImage?: UploadImageFn;
  onError?: (message: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uploading, setUploading] = useState(false);

  // D&D / ペーストで画像ファイルを検出したときの共通アップロード処理。
  // ツールバーのファイル選択（RichEditorToolbar）とは別経路のため、
  // アップロード中はツールバーの画像ボタンも disabled にして二重投入を防ぐ。
  async function handleImageUpload(file: File) {
    if (!onUploadImage) return;
    setUploading(true);
    try {
      const { url } = await onUploadImage(file);
      editor?.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : '画像のアップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  }

  const editor = useEditor({
    extensions: editorExtensions,
    content: initialMarkdown,
    editorProps: {
      attributes: {
        class: 'tiptap prose max-w-none min-h-[420px] px-4 py-3 focus:outline-none',
        'aria-label': '本文（リッチエディタ）',
      },
      handleDrop: (_view, event) => {
        const file = firstImageFile(event.dataTransfer?.files);
        if (!file || !onUploadImage) return false;
        event.preventDefault();
        void handleImageUpload(file);
        return true;
      },
      handlePaste: (_view, event) => {
        const file = firstImageFile(event.clipboardData?.files);
        if (!file || !onUploadImage) return false;
        event.preventDefault();
        void handleImageUpload(file);
        return true;
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
      <RichEditorToolbar editor={editor} onUploadImage={onUploadImage} uploading={uploading} />
      <EditorContent editor={editor} />
    </div>
  );
}
