// 例外（fetch 失敗など、レスポンスすら得られないケース）の共通文言。
// 非 2xx で本文にメッセージがあるときは errorMessage を使うこと。
export const NETWORK_ERROR_MESSAGE = '通信に失敗しました。時間をおいて再試行してください';

// サーバーの ApiError({code,message}) からメッセージを取り出す共通ヘルパー。
// 非 2xx レスポンスのボディが JSON でない場合も throw せず fallback に落とす。
// 各画面で同じ cast+fallback を書かないよう 1 箇所に集約する。
export async function errorMessage(
  res: { json(): Promise<unknown> },
  fallback: string,
): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
}

/** CSV インポート系のレスポンス details に載る行番号付きエラー。 */
export type ImportRowError = { line: number; email?: string; message: string };

// CSV インポート失敗ボディ（CSV_IMPORT_FAILED）から message と行エラーを取り出す。
// 成功判定のために本文を先に読む必要があるルートで使うので、res ではなく
// json() 済みのボディを受ける（errorMessage の details 対応版）。
export function importErrorBody(
  body: unknown,
  fallback: string,
): { message: string; details: ImportRowError[] } {
  const b = body as { message?: string; details?: ImportRowError[] } | null;
  return { message: b?.message ?? fallback, details: Array.isArray(b?.details) ? b.details : [] };
}
