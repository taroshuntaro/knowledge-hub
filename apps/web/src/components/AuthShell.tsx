import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          {/* CardTitle は div のため、単独ページの表題として h1 を直接置く */}
          <h1 className="text-xl leading-none font-semibold">{title}</h1>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
