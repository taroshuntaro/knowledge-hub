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
