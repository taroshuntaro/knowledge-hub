import { and, eq } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { users } from '../db/schema';
import type { Db } from '../types';
import { normalizeEmail } from './email';
import { hashPassword } from './password';
import { verifyRegistrationCode } from './registration-code-service';
import { createSession, toSessionUser } from './session-service';

/**
 * 登録コードで pending 行をクレームする。失敗理由（コード不正 / 行なし / クレーム済み /
 * 無効化済み）は呼び出し側で区別させない（アカウント列挙・状態漏洩の防止）ため常に null。
 * 条件付き UPDATE でアトミックにクレームし、並行二重クレームの 2 本目は 0 行で失敗する。
 */
export async function claimAccount(
  db: Db,
  input: { email: string; code: string; password: string },
): Promise<{ sid: string; user: SessionUser } | null> {
  const email = normalizeEmail(input.email);
  // コード不正でも同一コストを払い、レイテンシによるコード有効性オラクルを防ぐ
  // （scrypt を先に払ってから検証すると、全経路のレイテンシが揃う）。
  const passwordHash = await hashPassword(input.password);
  if (!(await verifyRegistrationCode(db, input.code))) return null;
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(users)
      .set({ authProvider: 'password', passwordHash })
      .where(and(eq(users.email, email), eq(users.authProvider, 'pending'), eq(users.isActive, true)))
      .returning();
    if (!claimed) return null;
    return { sid: await createSession(tx, claimed.id), user: toSessionUser(claimed) };
  });
}
