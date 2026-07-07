/**
 * 記事のヒーロー画像を 16:9 の枠に contain 表示する。16:9 の画像は枠を
 * 埋め、4:3 など縦長の画像は高さを 16:9 に合わせて左右に余白ができる。
 * 余白は同じ画像を拡大・ぼかした背景で自然に埋める（ピラーボックス）。
 * エディタ入力プレビューと記事詳細ページで同じ見た目にするための共通表示。
 */
export function HeroImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-muted ${className ?? ''}`}>
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl brightness-90"
      />
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 mx-auto h-full w-auto max-w-full object-contain"
      />
    </div>
  );
}
