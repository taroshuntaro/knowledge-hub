// PostgreSQL の SQLSTATE は、pg ドライバのラップの仕方により err.code か err.cause.code の
// どちらかに載る。この知識をここに閉じ込め、各サービスは判定関数だけを使う。
function pgErrorCode(e: unknown): string | undefined {
  return (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
}

/** 一意制約違反（23505）。TOCTOU の最終防衛線として AppError へ変換する用途で使う。 */
export function isUniqueViolation(e: unknown): boolean {
  return pgErrorCode(e) === '23505';
}

/** 外部キー制約違反（23503）。参照が残る行の削除を CONFLICT へ変換する用途で使う。 */
export function isForeignKeyViolation(e: unknown): boolean {
  return pgErrorCode(e) === '23503';
}
