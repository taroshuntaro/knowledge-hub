import type { SessionUser } from '@knowledge-hub/shared';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import type { Db } from '../types';
import { verifyPassword } from './password';
import { createSession, toSessionUser } from './session-service';

const DUMMY_PASSWORD_HASH =
  'scrypt:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function loginWithPassword(
  db: Db,
  rawEmail: string,
  password: string,
): Promise<{ sid: string; user: SessionUser } | null> {
  // 保存時に小文字化しているため照合も小文字化して行う（大文字小文字揺れの吸収）。
  const email = rawEmail.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const passwordHash =
    user?.isActive && user.authProvider === 'password' ? user.passwordHash : null;
  const passwordMatches = await verifyPassword(
    password,
    passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || passwordHash === null || !passwordMatches) {
    return null;
  }

  return db.transaction(async (tx) => {
    const [lockedUser] = await tx
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
      .for('update');
    if (
      !lockedUser ||
      !lockedUser.isActive ||
      lockedUser.authProvider !== 'password' ||
      lockedUser.passwordHash !== passwordHash
    ) {
      return null;
    }

    return {
      sid: await createSession(tx, lockedUser.id),
      user: toSessionUser(lockedUser),
    };
  });
}
