import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { testConfig } from '../test/helpers';

describe('GET /healthz', () => {
  it('200 と status:ok を返す', async () => {
    const app = buildApp({ db: null as never, config: testConfig(), mailer: null as never });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
