import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function AuthShell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-col items-center gap-1 text-center">
          {/* CardTitle は div のため、単独ページの表題として h1 を直接置く */}
          <h1 className="text-xl leading-none font-extrabold">
            knowledge<span className="text-ring">·</span>hub
          </h1>
          <p className="text-sm text-muted-foreground">チームの知見を、流れる場所へ</p>
          {title && <p className="pt-2 text-sm font-semibold">{title}</p>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
