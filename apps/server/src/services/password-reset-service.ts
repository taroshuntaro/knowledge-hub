import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Config } from '../config';
import { passwordResetTokens, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db, Mailer } from '../types';
import { hashPassword } from './password';
import { deleteUserSessions, hashToken } from './session-service';

const RESET_TTL_MS = 60 * 60 * 1000;

export async function requestPasswordReset(
  db: Db,
  mailer: Mailer,
  config: Config,
  email: string,
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: and(eq(users.email, email), eq(users.isActive, true), eq(users.authProvider, 'password')),
  });
  if (!user) return; // メール列挙攻撃対策: 存在有無を応答に出さない
  const token = randomBytes(32).toString('base64url');
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  await mailer.send(
    email,
    '【knowledge-hub】パスワード再設定',
    `以下のリンクからパスワードを再設定してください（1時間有効）:\n\n${config.appUrl}/password-reset/${token}`,
  );
}

export async function resetPassword(db: Db, token: string, newPassword: string): Promise<void> {
  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, hashToken(token)),
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError('INVALID_TOKEN', 'リンクが無効か、期限切れです', 400);
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, row.userId));
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, row.id));
  await deleteUserSessions(db, row.userId);
}
