import { useId, useState } from 'react';
import { ImageIcon, X } from 'lucide-react';
import { uploadImageWithId } from '@/lib/upload';
import { HeroImage } from '@/components/HeroImage';

/** 記事のヒーロー画像を設定・差し替え・削除する UI。value は uploadId。
 *  未設定時は上部を占有しないコンパクトな追加トリガー、設定時は 16:9
 *  contain＋ぼかし背景のプレビュー（HeroImage）と変更/削除操作を出す。 */
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
      {value ? (
        <div className="relative">
          <HeroImage src={`/api/uploads/${value}`} alt="ヒーロー画像" />
          <div className="absolute right-2 top-2 flex gap-1.5">
            <label
              htmlFor={inputId}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-background/80 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {uploading ? 'アップロード中…' : '画像を変更'}
            </label>
            <button
              type="button"
              aria-label="画像を削除"
              onClick={() => onChange(null)}
              className="inline-flex items-center justify-center rounded-md bg-background/80 p-1.5 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ImageIcon className="size-4" aria-hidden="true" />
          <span>{uploading ? 'アップロード中…' : 'ヒーロー画像を追加（任意）'}</span>
        </label>
      )}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        aria-label="ヒーロー画像を選択"
        disabled={uploading}
        onChange={(e) => void handleFileChange(e)}
        className="sr-only"
      />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
