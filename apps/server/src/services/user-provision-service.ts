import { eq, inArray } from 'drizzle-orm';
import { HIRE_YEAR_MIN, hireYearMax } from '@knowledge-hub/shared';
import { departments, positions, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { normalizeEmail } from './email';
import { parseCsv } from './csv';
import type { AdminUserView } from './user-service';
import { toAdminView } from './user-service';
import type { ImportError } from './user-import-service';
import { ensureDepartments, ensurePositions } from './user-import-service';

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

// master-service.ts の isUniqueViolation と同形。code は err.code か err.cause.code のどちらか
// （pg ドライバのラップの仕方に依存）に載るため両方見る。
function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === '23505';
}

/**
 * 管理者が個別にユーザーを事前作成する（登録コードで claim されるまで pending）。
 * role は常に member 固定。email 重複は EMAIL_TAKEN、departmentId/positionId の不在は
 * VALIDATION（updateUserByAdmin と同じ扱い）。
 */
export async function createPendingUser(db: Db, input: ProvisionInput): Promise<AdminUserView> {
  const email = normalizeEmail(input.email);

  // 事前チェックは高速パス（大半のリクエストで DB 制約違反の例外コストを避ける）。
  // 並行リクエストの TOCTOU は下の insert の catch で確実に EMAIL_TAKEN に変換する。
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) throw new AppError('EMAIL_TAKEN', 'このメールアドレスは既に登録されています', 409);

  if (input.departmentId) {
    const dep = await db.query.departments.findFirst({
      where: eq(departments.id, input.departmentId), columns: { id: true },
    });
    if (!dep) throw new AppError('VALIDATION', '所属が存在しません', 400);
  }
  if (input.positionId) {
    const pos = await db.query.positions.findFirst({
      where: eq(positions.id, input.positionId), columns: { id: true },
    });
    if (!pos) throw new AppError('VALIDATION', '役職が存在しません', 400);
  }

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
    const [emailRaw, displayNameRaw, department, position, hireYearRaw] = cells.map((v) => v.trim());
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
    if (!displayNameRaw) {
      errors.push({ line, email, message: 'display_name が空です' });
      continue;
    }
    let hireYear: number | null = null;
    if (hireYearRaw !== '') {
      const y = Number(hireYearRaw);
      if (!/^\d{4}$/.test(hireYearRaw) || !Number.isInteger(y) || y < HIRE_YEAR_MIN || y > hireYearMax()) {
        errors.push({
          line, email,
          message: `hire_year は ${HIRE_YEAR_MIN}〜${hireYearMax()} の整数か空欄にしてください`,
        });
        continue;
      }
      hireYear = y;
    }
    rows.push({ line, email, displayName: displayNameRaw, department, position, hireYear });
  }

  if (rows.length === 0 && errors.length === 0) {
    return { ok: false, errors: [{ line: 1, message: 'データ行がありません' }] };
  }

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
