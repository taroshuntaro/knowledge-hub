import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

// 実用的 CSP: SPA（Vite ビルドを serveStatic で配信）で破損しない範囲で XSS を層防御する。
// style-src 'unsafe-inline' は多くの UI コンポーネント（Radix/shadcn のポップオーバー等）が
// インラインの位置指定 style を注入するため必須。img-src 'self' data: は外部画像をブロック
// する意図的な選択(画像はアプリ配信 /api/uploads、§8)。
const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(options: { hsts: boolean }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('Content-Security-Policy', CSP);
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // HSTS は https 前提の本番のみ。開発の http に配ると以後ブラウザが http を拒否して事故る。
    if (options.hsts) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  };
}
