import { eq, inArray, sql } from 'drizzle-orm';
import { HIRE_YEAR_MIN, hireYearMax } from '@knowledge-hub/shared';
import { departments, positions, users } from '../db/schema';
import type { Db } from '../types';
import { parseCsv } from './csv';

export type ImportError = { line: number; email?: string; message: string };
export type ImportResult =
  | { ok: true; updated: number; createdDepartments: string[]; createdPositions: string[] }
  | { ok: false; errors: ImportError[] };

const HEADER = ['email', 'department', 'position', 'hire_year'];

type ParsedRow = {
  line: number;
  email: string;
  department: string; // trim 済み。'' はクリア
  position: string;
  hireYear: number | null;
};

/**
 * CSV でユーザーの所属・役職・入社年を一括設定する。
 * - email をキーに更新。空欄はクリア（CSV は「記載ユーザーの正」）。未記載ユーザーは変更しない。
 * - 未知の所属・役職名はマスタへ自動登録（trim 後の完全一致、sortOrder は末尾）。
 * - all-or-nothing: 1 件でもエラーなら何も適用しない。適用は単一トランザクション。
 */
export async function importUserOrg(db: Db, csvText: string): Promise<ImportResult> {
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
    const [email, department, position, hireYearRaw] = cells.map((v) => v.trim());
    if (!email) {
      errors.push({ line, message: 'email が空です' });
      continue;
    }
    if (seenEmails.has(email)) {
      errors.push({ line, email, message: '同じ email の行が重複しています' });
      continue;
    }
    seenEmails.add(email);
    let hireYear: number | null = null;
    if (hireYearRaw !== '') {
      const y = Number(hireYearRaw);
      if (!Number.isInteger(y) || y < HIRE_YEAR_MIN || y > hireYearMax()) {
        errors.push({
          line, email,
          message: `hire_year は ${HIRE_YEAR_MIN}〜${hireYearMax()} の整数か空欄にしてください`,
        });
        continue;
      }
      hireYear = y;
    }
    rows.push({ line, email, department, position, hireYear });
  }

  if (rows.length === 0 && errors.length === 0) {
    return { ok: false, errors: [{ line: 1, message: 'データ行がありません' }] };
  }

  return db.transaction(async (tx) => {
    const found = rows.length > 0
      ? await tx
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
      return { ok: false as const, errors: errors.sort((a, b) => a.line - b.line) };
    }

    const createdDepartments = await ensureDepartments(
      tx, [...new Set(rows.map((r) => r.department).filter((n) => n !== ''))],
    );
    const createdPositions = await ensurePositions(
      tx, [...new Set(rows.map((r) => r.position).filter((n) => n !== ''))],
    );
    const depIdByName = new Map(
      (await tx.select({ id: departments.id, name: departments.name }).from(departments))
        .map((d) => [d.name, d.id]),
    );
    const posIdByName = new Map(
      (await tx.select({ id: positions.id, name: positions.name }).from(positions))
        .map((p) => [p.name, p.id]),
    );

    for (const r of rows) {
      await tx
        .update(users)
        .set({
          departmentId: r.department === '' ? null : depIdByName.get(r.department)!,
          positionId: r.position === '' ? null : posIdByName.get(r.position)!,
          hireYear: r.hireYear,
        })
        .where(eq(users.id, idByEmail.get(r.email)!));
    }
    return { ok: true as const, updated: rows.length, createdDepartments, createdPositions };
  });
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function ensureDepartments(tx: Tx, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const existing = new Set(
    (await tx.select({ name: departments.name }).from(departments)).map((d) => d.name),
  );
  const missing = names.filter((n) => !existing.has(n));
  if (missing.length === 0) return [];
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${departments.sortOrder}), -1) + 1` })
    .from(departments);
  await tx.insert(departments).values(missing.map((name, i) => ({ name, sortOrder: next + i })));
  return missing;
}

async function ensurePositions(tx: Tx, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const existing = new Set(
    (await tx.select({ name: positions.name }).from(positions)).map((p) => p.name),
  );
  const missing = names.filter((n) => !existing.has(n));
  if (missing.length === 0) return [];
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${positions.sortOrder}), -1) + 1` })
    .from(positions);
  await tx.insert(positions).values(missing.map((name, i) => ({ name, sortOrder: next + i })));
  return missing;
}
