/** クエリ失敗時の共通表示。文言だけ差し替えたい場合は message を渡す。 */
export function ErrorState({ message = '読み込みに失敗しました。' }: { message?: string }) {
  return <p className="text-destructive">{message}</p>;
}
