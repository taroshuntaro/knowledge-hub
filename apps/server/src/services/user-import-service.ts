import { eq, inArray, sql } from 'drizzle-orm';
import { HIRE_YEAR_MIN, hireYearMax } from '@knowledge-hub/shared';
import { departments, positions, users } from '../db/schema';
import type { Db } from '../types';
import { parseEmailCsv, type ImportError } from './csv';

export type { ImportError };
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
 * hire_year セルの共通検証（本 CSV と登録 CSV で同一ルール）。
 * '' は null（未設定）、不正値は error を呼んで undefined を返す。
 */
export function parseHireYearCell(
  raw: string,
  error: (message: string) => void,
): number | null | undefined {
  if (raw === '') return null;
  const y = Number(raw);
  if (!/^\d{4}$/.test(raw) || !Number.isInteger(y) || y < HIRE_YEAR_MIN || y > hireYearMax()) {
    error(`hire_year は ${HIRE_YEAR_MIN}〜${hireYearMax()} の整数か空欄にしてください`);
    return undefined;
  }
  return y;
}

/**
 * CSV でユーザーの所属・役職・入社年を一括設定する。
 * - email をキーに更新。空欄はクリア（CSV は「記載ユーザーの正」）。未記載ユーザーは変更しない。
 * - 未知の所属・役職名はマスタへ自動登録（trim 後の完全一致、sortOrder は末尾）。
 * - all-or-nothing: 1 件でもエラーなら何も適用しない。適用は単一トランザクション。
 */
export async function importUserOrg(db: Db, csvText: string): Promise<ImportResult> {
  const parsed = parseEmailCsv<ParsedRow>(csvText, HEADER, ({ line, email, cells, error }) => {
    const [department, position, hireYearRaw] = cells;
    const hireYear = parseHireYearCell(hireYearRaw, error);
    if (hireYear === undefined) return null;
    return { line, email, department, position, hireYear };
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const { rows, errors } = parsed;

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

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export async function ensureDepartments(tx: Tx, names: string[]): Promise<string[]> {
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

export async function ensurePositions(tx: Tx, names: string[]): Promise<string[]> {
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
