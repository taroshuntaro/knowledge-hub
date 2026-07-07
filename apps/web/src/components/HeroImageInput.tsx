import { useId, useState } from 'react';
import { ImageIcon, X } from 'lucide-react';
import { uploadImageWithId } from '@/lib/upload';

/** 記事のヒーロー画像（16:9）を設定・差し替え・削除する UI。value は uploadId。 */
export function HeroImageInput(props: { value: string | null; onChange: (uploadId: string | null) => void }) {
  const { value, onChange } = props;
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { id } = await uploadImageWithId(file);
      onChange(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像のアップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <div className="aspect-[16/9] w-full overflow-hidden rounded-md border bg-muted">
        {value ? (
          <div className="relative h-full w-full">
            <img src={`/api/uploads/${value}`} alt="ヒーロー画像" className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="画像を削除"
              onClick={() => onChange(null)}
              className="absolute right-2 top-2 inline-flex items-center justify-center rounded-md bg-background/80 p-1.5 text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <label
            htmlFor={inputId}
            className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 border border-dashed text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ImageIcon className="size-8" aria-hidden="true" />
            <span>{uploading ? 'アップロード中…' : '画像を選択'}</span>
            <input
              id={inputId}
              type="file"
              accept="image/*"
              aria-label="ヒーロー画像を選択"
              disabled={uploading}
              onChange={(e) => void handleFileChange(e)}
              className="sr-only"
            />
          </label>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
