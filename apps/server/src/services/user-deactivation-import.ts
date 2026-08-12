import { inArray } from 'drizzle-orm';
import { users } from '../db/schema';
import type { Db } from '../types';
import { parseEmailCsv, type ImportError } from './csv';
import { deactivateUsers } from './user-service';

export type DeactivationImportResult =
  | { ok: true; deactivated: number }
  | { ok: false; errors: ImportError[] };

const HEADER = ['email'];

type ParsedRow = { line: number; email: string };

/**
 * CSV（1列: email）で複数ユーザーを一括無効化する。
 * - email は正規化（trim + 小文字化）して照合する。空欄・CSV内重複はその行のエラー。
 * - 未知の email も行エラー（'このメールアドレスのユーザーがいません'）。
 * - all-or-nothing: 1 件でもエラーなら何も無効化しない。
 * - id 解決後は deactivateUsers に委譲する。LAST_ADMIN はバッチ全体に関わる制約のため
 *   行エラーに変換せず AppError のまま呼び出し元に伝播させる。
 */
export async function importUserDeactivations(
  db: Db,
  csvText: string,
): Promise<DeactivationImportResult> {
  const parsed = parseEmailCsv<ParsedRow>(csvText, HEADER, ({ line, email }) => ({ line, email }));
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const { rows, errors } = parsed;

  const found = rows.length > 0
    ? await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.email, rows.map((r) => r.email)))
    : [];
  const idByEmail = new Map(found.map((u) => [u.email, u.id]));
  for (const r of rows) {
    if (!idByEmail.has(r.email)) {
      errors.push({ line: r.line, email: r.email, message: 'このメールアドレスのユーザーがいません' });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors: errors.sort((a, b) => a.line - b.line) };
  }

  const { deactivated } = await deactivateUsers(db, rows.map((r) => idByEmail.get(r.email)!));
  return { ok: true, deactivated };
}
