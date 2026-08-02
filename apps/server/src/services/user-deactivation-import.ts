import { inArray } from 'drizzle-orm';
import { users } from '../db/schema';
import type { Db } from '../types';
import { normalizeEmail } from './email';
import { parseCsv } from './csv';
import type { ImportError } from './user-import-service';
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
 *
 * 既知の制約: parseCsv は「1 フィールドのみの空白行はデータと区別できず取り除く」実装
 * （csv.ts 冒頭のコメント参照）。そのため 1 列 CSV では「完全に空の行」を email 空欄の
 * 行エラーとして検出できない（parseCsv の時点で行ごと消える）。email セルに値はあるが
 * 空文字列という状況が単独では発生し得ないため実害は限定的だが、他の列を持つ CSV とは
 * 挙動が異なる点として明記しておく。
 */
export async function importUserDeactivations(
  db: Db,
  csvText: string,
): Promise<DeactivationImportResult> {
  const table = parseCsv(csvText);
  if (table.length === 0) {
    return { ok: false, errors: [{ line: 1, message: 'CSV が空です' }] };
  }
  if (table[0].map((h) => h.trim()).join(',') !== HEADER.join(',')) {
    return {
      ok: false,
      errors: [{ line: 1, message: `ヘッダー行は ${HEADER.join(',')} にしてください` }],
    };
  }

  const errors: ImportError[] = [];
  const rows: ParsedRow[] = [];
  const seenEmails = new Set<string>();
  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const cells = table[i];
    if (cells.length !== HEADER.length) {
      errors.push({ line, message: `列数が不正です（${HEADER.length} 列必要）` });
      continue;
    }
    const [emailRaw] = cells.map((v) => v.trim());
    if (!emailRaw) {
      errors.push({ line, message: 'email が空です' });
      continue;
    }
    const email = normalizeEmail(emailRaw);
    if (seenEmails.has(email)) {
      errors.push({ line, email, message: '同じ email の行が重複しています' });
      continue;
    }
    seenEmails.add(email);
    rows.push({ line, email });
  }

  if (rows.length === 0 && errors.length === 0) {
    return { ok: false, errors: [{ line: 1, message: 'データ行がありません' }] };
  }

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
