import { Skeleton } from '@/components/ui/skeleton';

export function Loading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <p className="sr-only">読み込み中…</p>
    </div>
  );
}
