import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { editorExtensions } from '@/lib/editor/extensions';
import { firstImageFile } from '@/lib/upload';
import { RichEditorToolbar } from './RichEditorToolbar';

export type UploadImageFn = (file: File) => Promise<{ url: string }>;

/**
 * アップロード実行から挿入・エラー通知・uploading 状態管理までを一括で行う
 * ハンドラの型。ツールバーのファイル選択も D&D / ペーストと同じこのハンドラ
 * を通すことで、3 経路すべてで成功時の挿入・失敗時の onError 通知・
 * uploading 中の disabled 制御を統一する。
 */
export type ImageUploadHandler = (file: File) => Promise<void>;

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

  // アンマウント時（例: リッチ→ソース切替）に 500ms デバウンス待ちの
  // onChangeMarkdown が残っていると、直近の編集が bodyMd に反映されないまま
  // 破棄されてしまう。clearTimeout の前に必ず現在の内容で一度フラッシュする。
  // なお tiptap の useEditor 内部クリーンアップは実 destroy を次ティック以降に
  // 遅延させる（scheduleDestroy）ため、本 effect の cleanup 実行時点では
  // editor はまだ破棄されていない。それでも念のため isDestroyed を防御的に確認する。
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        if (editor && !editor.isDestroyed) {
          onChangeMarkdown(editor.storage.markdown.getMarkdown());
        }
      }
    },
    [editor, onChangeMarkdown],
  );

  if (!editor) return null;
  return (
    <div className="overflow-hidden rounded-lg border focus-within:ring-2 focus-within:ring-ring">
      <RichEditorToolbar
        editor={editor}
        onUploadImage={onUploadImage ? handleImageUpload : undefined}
        uploading={uploading}
      />
      <EditorContent editor={editor} />
    </div>
  );
}
