import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import type { Config } from '../config';
import { invitations, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db, Mailer } from '../types';
import { hashPassword } from './password';
import { createSession, hashToken, toSessionUser } from './session-service';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvitation(
  db: Db,
  mailer: Mailer,
  config: Config,
  email: string,
): Promise<void> {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    throw new AppError('EMAIL_TAKEN', 'このメールアドレスは既に登録されています', 409);
  }
  const token = randomBytes(32).toString('base64url');
  await db.insert(invitations).values({
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
  });
  await mailer.send(
    email,
    '【knowledge-hub】アカウント登録のご招待',
    `knowledge-hub に招待されました。以下のリンクからアカウントを登録してください（7日間有効）:\n\n${config.appUrl}/invite/${token}`,
  );
}

export async function acceptInvitation(
  db: Db,
  token: string,
  input: { displayName: string; password: string },
): Promise<{ sid: string; user: SessionUser }> {
  const inv = await db.query.invitations.findFirst({
    where: eq(invitations.tokenHash, hashToken(token)),
  });
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) {
    throw new AppError('INVALID_TOKEN', '招待リンクが無効か、期限切れです', 400);
  }
  const [user] = await db
    .insert(users)
    .values({
      email: inv.email,
      displayName: input.displayName,
      authProvider: 'password',
      passwordHash: await hashPassword(input.password),
    })
    .returning();
  await db.update(invitations).set({ usedAt: new Date() }).where(eq(invitations.id, inv.id));
  const sid = await createSession(db, user.id);
  return { sid, user: toSessionUser(user) };
}
