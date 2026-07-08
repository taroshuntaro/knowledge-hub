import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';

export type CursorPage<T> = { items: T[]; nextCursor: string | null };

/**
 * カーソルページング付き useInfiniteQuery の共通ラッパー。
 * initialPageParam / getNextPageParam / pages.flatMap という定型を 1 箇所に集約し、
 * 各画面は queryKey と「cursor を受け取り 1 ページ返す fetcher」だけを渡す。
 */
export function useCursorList<T>(
  queryKey: QueryKey,
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
  options?: { enabled?: boolean },
) {
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: options?.enabled,
  });
  return {
    items: (query.data?.pages ?? []).flatMap((p) => p.items),
    isLoading: query.isLoading,
    isError: query.isError,
    hasNextPage: !!query.hasNextPage,
    fetchNextPage: () => query.fetchNextPage(),
  };
}
