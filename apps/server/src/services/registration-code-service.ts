import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { registrationCodes } from '../db/schema';
import type { Db } from '../types';
import { hashToken } from './session-service';

// 紛らわしい文字（I/L/O/0/1）を除いた 31 文字。16 文字 ≈ 79bit で総当たり不能。
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const chars = Array.from(randomBytes(16), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

const activeWhere = () =>
  and(isNull(registrationCodes.revokedAt), gt(registrationCodes.expiresAt, new Date()));

export async function issueRegistrationCode(db: Db, expiresInDays: number) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  await db.transaction(async (tx) => {
    await tx.update(registrationCodes).set({ revokedAt: new Date() }).where(isNull(registrationCodes.revokedAt));
    await tx.insert(registrationCodes).values({ codeHash: hashToken(code), expiresAt });
  });
  return { code, expiresAt };
}

export async function revokeActiveCode(db: Db): Promise<void> {
  await db.update(registrationCodes).set({ revokedAt: new Date() }).where(isNull(registrationCodes.revokedAt));
}

export async function getActiveCodeMeta(db: Db) {
  const [row] = await db
    .select({ createdAt: registrationCodes.createdAt, expiresAt: registrationCodes.expiresAt })
    .from(registrationCodes).where(activeWhere()).limit(1);
  return row ?? null;
}

export async function verifyRegistrationCode(db: Db, code: string): Promise<boolean> {
  const [row] = await db
    .select({ id: registrationCodes.id })
    .from(registrationCodes)
    .where(and(eq(registrationCodes.codeHash, hashToken(code)), activeWhere()))
    .limit(1);
  return row !== undefined;
}
