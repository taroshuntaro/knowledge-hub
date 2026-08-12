import { eq, inArray } from 'drizzle-orm';
import { departments, positions, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { normalizeEmail } from './email';
import { parseEmailCsv, type ImportError } from './csv';
import { isUniqueViolation } from './pg-error';
import type { AdminUserView } from './user-service';
import { toAdminView } from './user-service';
import { ensureDepartments, ensurePositions, parseHireYearCell } from './user-import-service';

export type ProvisionInput = {
  email: string;
  displayName: string;
  departmentId?: string | null;
  positionId?: string | null;
  hireYear?: number | null;
};

export type RegistrationImportResult =
  | { ok: true; created: number; createdDepartments: string[]; createdPositions: string[] }
  | { ok: false; errors: ImportError[] };

const HEADER = ['email', 'display_name', 'department', 'position', 'hire_year'];

type ParsedRow = {
  line: number;
  email: string;
  displayName: string;
  department: string; // trim 済み。'' は未割当
  position: string;
  hireYear: number | null;
};

/**
 * 管理者が個別にユーザーを事前作成する（登録コードで claim されるまで pending）。
 * role は常に member 固定。email 重複は EMAIL_TAKEN、departmentId/positionId の不在は
 * VALIDATION（updateUserByAdmin と同じ扱い）。
 */
export async function createPendingUser(db: Db, input: ProvisionInput): Promise<AdminUserView> {
  const email = normalizeEmail(input.email);

  const [dep, pos] = await Promise.all([
    input.departmentId
      ? db.query.departments.findFirst({
          where: eq(departments.id, input.departmentId), columns: { id: true },
        })
      : undefined,
    input.positionId
      ? db.query.positions.findFirst({
          where: eq(positions.id, input.positionId), columns: { id: true },
        })
      : undefined,
  ]);
  if (input.departmentId && !dep) throw new AppError('VALIDATION', '所属が存在しません', 400);
  if (input.positionId && !pos) throw new AppError('VALIDATION', '役職が存在しません', 400);

  try {
    const [row] = await db
      .insert(users)
      .values({
        email,
        displayName: input.displayName,
        authProvider: 'pending',
        passwordHash: null,
        departmentId: input.departmentId ?? null,
        positionId: input.positionId ?? null,
        hireYear: input.hireYear ?? null,
      })
      .returning();
    return toAdminView(row);
  } catch (e) {
    // email 重複は事前チェックせず、一意制約違反で検出する（TOCTOU なしで確実）。
    if (isUniqueViolation(e)) throw new AppError('EMAIL_TAKEN', 'このメールアドレスは既に登録されています', 409);
    throw e;
  }
}

/**
 * CSV で複数ユーザーを一括で pending 事前作成する。
 * - email + display_name 必須。department/position は空欄可で未知名はマスタへ自動登録。
 * - hire_year の検証は importUserOrg と同じ範囲（HIRE_YEAR_MIN〜hireYearMax()）。
 * - all-or-nothing: 1 件でもエラーなら何も作らない。適用は単一トランザクション。
 */
export async function importUserRegistrations(db: Db, csvText: string): Promise<RegistrationImportResult> {
  const parsed = parseEmailCsv<ParsedRow>(csvText, HEADER, ({ line, email, cells, error }) => {
    const [displayNameRaw, department, position, hireYearRaw] = cells;
    if (!displayNameRaw) {
      error('display_name が空です');
      return null;
    }
    const hireYear = parseHireYearCell(hireYearRaw, error);
    if (hireYear === undefined) return null;
    return { line, email, displayName: displayNameRaw, department, position, hireYear };
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const { rows, errors } = parsed;

  return db.transaction(async (tx) => {
    const existing = rows.length > 0
      ? await tx
          .select({ email: users.email })
          .from(users)
          .where(inArray(users.email, rows.map((r) => r.email)))
      : [];
    for (const e of existing) {
      const row = rows.find((r) => r.email === e.email)!;
      errors.push({ line: row.line, email: e.email, message: 'このメールアドレスは既に登録されています' });
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

    await tx.insert(users).values(rows.map((r) => ({
      email: r.email,
      displayName: r.displayName,
      authProvider: 'pending' as const,
      passwordHash: null,
      departmentId: r.department === '' ? null : depIdByName.get(r.department)!,
      positionId: r.position === '' ? null : posIdByName.get(r.position)!,
      hireYear: r.hireYear,
    })));
    return { ok: true as const, created: rows.length, createdDepartments, createdPositions };
  });
}
