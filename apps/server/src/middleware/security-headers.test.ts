import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test/helpers';

describe('security headers', () => {
  const ctx = createTestApp();
  afterAll(() => ctx.pool.end());

  it('全レスポンスに CSP とセキュリティヘッダが付く（/healthz で確認）', async () => {
    const res = await ctx.app.request('/healthz');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
});
