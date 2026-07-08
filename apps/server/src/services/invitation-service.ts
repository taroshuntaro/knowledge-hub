import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import type { Config } from '../config';
import { invitations, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db, Mailer } from '../types';
import { normalizeEmail } from './email';
import { hashPassword } from './password';
import { createSession, hashToken, toSessionUser } from './session-service';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvitation(
  db: Db,
  mailer: Mailer,
  config: Config,
  rawEmail: string,
): Promise<void> {
  // email は正準形（小文字）で保存する。OIDC は lower() で照合するため、
  // 大文字小文字の違いで同一メールに複数行ができるのを防ぐ（アカウント重複/乗っ取り対策）。
  const email = normalizeEmail(rawEmail);
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
  // 同一メールに複数の招待が発行され、別トークンで既に登録済みのケースを
  // users.email の一意制約違反（500）ではなく明示的なエラーで返す。
  const existing = await db.query.users.findFirst({ where: eq(users.email, inv.email) });
  if (existing) {
    throw new AppError('EMAIL_TAKEN', 'このメールアドレスは既に登録されています', 409);
  }
  const passwordHash = await hashPassword(input.password);
  const user = await db.transaction(async (tx) => {
    // 条件付き UPDATE でトークンを claim してからユーザーを作る（M-3）。
    // 並行受諾の 2 本目は 0 行ヒットで INVALID_TOKEN になり、users の
    // unique 制約違反（500）に到達しない。失敗時は claim ごとロールバック。
    const claimed = await tx
      .update(invitations)
      .set({ usedAt: new Date() })
      .where(and(eq(invitations.id, inv.id), isNull(invitations.usedAt)))
      .returning({ id: invitations.id });
    if (claimed.length === 0) {
      throw new AppError('INVALID_TOKEN', '招待リンクが無効か、期限切れです', 400);
    }
    const [created] = await tx
      .insert(users)
      .values({
        email: inv.email,
        displayName: input.displayName,
        authProvider: 'password',
        passwordHash,
      })
      .returning();
    return created;
  });
  const sid = await createSession(db, user.id);
  return { sid, user: toSessionUser(user) };
}
