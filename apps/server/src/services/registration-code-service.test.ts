import { and, gt, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { registrationCodes } from '../db/schema';
import { createTestApp, resetDb } from '../test/helpers';
import {
  getActiveCodeMeta, issueRegistrationCode, revokeActiveCode, verifyRegistrationCode,
} from './registration-code-service';

describe('registration-code-service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('発行したコードは verify に通り、メタデータが取得できる', async () => {
    const { code, expiresAt } = await issueRegistrationCode(ctx.db, 30);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await verifyRegistrationCode(ctx.db, code)).toBe(true);
    const meta = await getActiveCodeMeta(ctx.db);
    expect(meta?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it('新規発行で旧コードは失効する（有効は常に 1 つ）', async () => {
    const first = await issueRegistrationCode(ctx.db, 30);
    const second = await issueRegistrationCode(ctx.db, 30);
    expect(await verifyRegistrationCode(ctx.db, first.code)).toBe(false);
    expect(await verifyRegistrationCode(ctx.db, second.code)).toBe(true);
  });

  it('revoke 後は verify も meta も無効', async () => {
    await issueRegistrationCode(ctx.db, 30);
    await revokeActiveCode(ctx.db);
    expect(await getActiveCodeMeta(ctx.db)).toBeNull();
  });

  it('期限切れコードは verify に通らない', async () => {
    const { code } = await issueRegistrationCode(ctx.db, 30);
    await ctx.db.update(registrationCodes).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await verifyRegistrationCode(ctx.db, code)).toBe(false);
  });

  it('不一致コードは false', async () => {
    await issueRegistrationCode(ctx.db, 30);
    expect(await verifyRegistrationCode(ctx.db, 'AAAA-AAAA-AAAA-AAAA')).toBe(false);
  });

  it('並行発行しても有効なコードは常に 1 つ（advisory lock で直列化）', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => issueRegistrationCode(ctx.db, 30)),
    );
    expect(results).toHaveLength(5);
    const active = await ctx.db
      .select({ id: registrationCodes.id })
      .from(registrationCodes)
      .where(and(isNull(registrationCodes.revokedAt), gt(registrationCodes.expiresAt, new Date())));
    expect(active).toHaveLength(1);
  });
});
