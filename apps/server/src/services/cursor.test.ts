import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { decodeCursor, encodeCursor } from './cursor';

const UUID = '47395b74-5d75-487d-9ee6-481eb4c32ebc';

describe('cursor encode/decode', () => {
  it('Date と id を round-trip できる', () => {
    const d = new Date('2026-07-07T01:02:03.456Z');
    const c = encodeCursor(d, UUID);
    expect(decodeCursor(c)).toEqual({ sortKey: '2026-07-07T01:02:03.456Z', id: UUID });
  });

  it('null sortKey から作ったカーソル（空 sortKey）は VALIDATION 400（実運用では発生しないが、防御的に拒否する）', () => {
    const c = encodeCursor(null, UUID);
    expect(() => decodeCursor(c)).toThrow(AppError);
    try {
      decodeCursor(c);
    } catch (e) {
      expect((e as AppError).status).toBe(400);
      expect((e as AppError).code).toBe('VALIDATION');
    }
  });

  it('base64url 化け（| 欠落）は VALIDATION 400', () => {
    const bad = Buffer.from('no-separator-here').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
    try {
      decodeCursor(bad);
    } catch (e) {
      expect((e as AppError).status).toBe(400);
      expect((e as AppError).code).toBe('VALIDATION');
    }
  });

  it('id が UUID でないカーソルは VALIDATION 400', () => {
    const bad = Buffer.from('2026-07-07T00:00:00.000Z|not-a-uuid').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
  });

  it('sortKey が空でも ISO でもない場合は VALIDATION 400', () => {
    const bad = Buffer.from(`garbage-date|${UUID}`).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
  });

  it('まったくの非 base64 文字列も 400（例外は AppError に正規化）', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(AppError);
  });
});

describe('不正カーソルは実エンドポイントで 400', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('GET /api/me/bookmarks?cursor=<garbage> は 400', async () => {
    const email = 'cursor@example.com';
    await createTestUser(ctx.db, { email });
    const login = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const res = await ctx.app.request('/api/me/bookmarks?cursor=!!!garbage!!!', { headers: { cookie } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION');
  });
});
