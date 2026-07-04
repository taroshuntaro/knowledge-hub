import { randomUUID } from 'node:crypto';
import { users } from '../db/schema';
import { hashPassword } from '../services/password';
import type { Db } from '../types';

export const TEST_PASSWORD = 'correct-horse-battery';

export async function createTestUser(
  db: Db,
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const passwordHash = Object.hasOwn(overrides, 'passwordHash')
    ? overrides.passwordHash
    : await hashPassword(TEST_PASSWORD);
  const [row] = await db
    .insert(users)
    .values({
      email: `u-${randomUUID()}@example.com`,
      displayName: 'テスト太郎',
      authProvider: 'password',
      passwordHash,
      ...overrides,
    })
    .returning();
  return row;
}
