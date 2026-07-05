import { FileText } from 'lucide-react';

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-muted-foreground">
      <FileText className="size-8" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
