import { randomUUID } from 'node:crypto';
import { articles, categories, users } from '../db/schema';
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

export async function createTestCategory(
  db: Db,
  overrides: Partial<typeof categories.$inferInsert> = {},
) {
  const [row] = await db
    .insert(categories)
    .values({ name: 'テック', ...overrides })
    .returning();
  return row;
}

export async function createTestArticle(
  db: Db,
  overrides: Partial<typeof articles.$inferInsert> = {},
) {
  const authorId = overrides.authorId ?? (await createTestUser(db)).id;
  const [row] = await db
    .insert(articles)
    .values({ authorId, title: 'テスト記事', bodyMd: '本文', ...overrides })
    .returning();
  return row;
}
