# プロフィール一覧（メンバー名簿） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 検索・絞り込み・並び替えができるメンバー一覧ページ（/members）と、管理者による所属・役職・入社年の設定（個別編集 + CSV 一括 + マスタ管理）を実装する。

**Architecture:** 所属（departments）・役職（positions）をマスタテーブルで管理し、users に nullable な FK と hireYear を追加する。`GET /api/profiles` が一覧 + マスタを全件返し、検索・絞り込み・並び替えはクライアントサイドで行う。CSV インポートは all-or-nothing（1 行でもエラーなら未適用）。

**Tech Stack:** Hono + Drizzle + PostgreSQL（Testcontainers テスト）、Zod（packages/shared が契約）、React + TanStack Query + hc<AppType>、Playwright。

**Spec:** `docs/superpowers/specs/2026-07-14-profile-directory-design.md`

## Global Constraints

- 検証ゲート: 最終タスクで `pnpm run verify` を green にする。各タスクでは対象パッケージのテストを回す。
- マイグレーションは手書きしない。`apps/server/src/db/schema.ts` を変更して `pnpm --filter @knowledge-hub/server db:generate`。
- 契約（Zod スキーマ・ERROR_CODES）は `packages/shared` に置く。`as` での握り潰しを増やさない（既存の `res.json() as T` パターンの踏襲は可）。
- サーバーは `AppError(code, message, status)` を投げる。Web は `errorMessage(res, fallback)` / `NETWORK_ERROR_MESSAGE` を使い、文言をベタ書きしない。
- パス UUID 検証は `routes/guards.ts` の `requireUuidParam` をルート層で使う。
- Web の UI 文言は日本語。
- コミットは英語・Conventional Commits・1 コミット 1 論理変更。main へ直接コミットしない（作業ブランチ: `feat/profile-directory`）。push は指示があるまでしない。
- hireYear の検証範囲: 1950 〜 現在年 + 1。
- サーバーのサービステストは Docker 起動が前提（Testcontainers）。

---

### Task 1: DB スキーマ（departments / positions / users 拡張）とマイグレーション

**Files:**
- Modify: `apps/server/src/db/schema.ts`（categories の手前にマスタ 2 表を追加、users に 3 カラム追加）
- Modify: `apps/server/src/test/helpers.ts:68-72`（resetDb の truncate 対象に追加）
- Create: `apps/server/drizzle/`（db:generate が生成する SQL。手書きしない）

**Interfaces:**
- Produces: `departments` / `positions` テーブル（`id: uuid PK` / `name: text unique` / `sortOrder: integer default 0` / `createdAt`）、`users.departmentId` / `users.positionId`（uuid, nullable, ON DELETE SET NULL）/ `users.hireYear`（integer, nullable）。以降の全タスクがこれを参照する。

- [ ] **Step 1: schema.ts にテーブルとカラムを追加**

`users` テーブル定義（11 行目〜）の**手前**に追加:

```ts
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const positions = pgTable('positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`users` の `isActive` 行の直後に追加:

```ts
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  positionId: uuid('position_id').references(() => positions.id, { onDelete: 'set null' }),
  hireYear: integer('hire_year'),
```

- [ ] **Step 2: マイグレーション生成**

Run: `pnpm --filter @knowledge-hub/server db:generate`
Expected: `apps/server/drizzle/` に新しい SQL ファイルが生成される（CREATE TABLE departments / positions、ALTER TABLE users）。

- [ ] **Step 3: resetDb の truncate 対象に追加**

`apps/server/src/test/helpers.ts` の resetDb を変更（departments / positions は users から参照される側なので users の truncate では消えない）:

```ts
export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate table article_tags, article_revisions, articles, tags, categories, uploads, users, sessions, invitations, password_reset_tokens, departments, positions cascade`,
  );
}
```

- [ ] **Step 4: 型チェックと既存テストで回帰確認**

Run: `pnpm --filter @knowledge-hub/server typecheck && pnpm --filter @knowledge-hub/server test`
Expected: PASS（Testcontainers が起動時に新マイグレーションを自動適用する）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/test/helpers.ts apps/server/drizzle
git commit -m "feat(server): add departments/positions tables and user org columns"
```

---

### Task 2: shared 契約（マスタ・入社年・admin 更新スキーマ・ERROR_CODES）

**Files:**
- Create: `packages/shared/src/schemas/profile.ts`
- Test: `packages/shared/src/schemas/profile.test.ts`
- Modify: `packages/shared/src/schemas/auth.ts:33-40`（updateUserByAdminSchema 拡張）
- Modify: `packages/shared/src/errors.ts`（`CSV_IMPORT_FAILED` 追加）
- Modify: `packages/shared/src/index.ts`（`export * from './schemas/profile';` 追加）

**Interfaces:**
- Produces: `createMasterSchema`（`{ name: string }`）、`updateMasterSchema`（`{ name?, sortOrder? }` いずれか必須）、`hireYearSchema`（int, 1950〜現在年+1）、`HIRE_YEAR_MIN`、`hireYearMax(): number`、ERROR_CODES に `'CSV_IMPORT_FAILED'`。`updateUserByAdminSchema` に `departmentId` / `positionId`（uuid | null, optional）と `hireYear`（number | null, optional）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/shared/src/schemas/profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMasterSchema, hireYearMax, hireYearSchema, updateMasterSchema } from './profile';
import { updateUserByAdminSchema } from './auth';

describe('profile schemas', () => {
  it('マスタ名は trim され、空は拒否', () => {
    expect(createMasterSchema.parse({ name: ' 開発部 ' })).toEqual({ name: '開発部' });
    expect(createMasterSchema.safeParse({ name: '  ' }).success).toBe(false);
  });

  it('updateMasterSchema は name / sortOrder どちらも無いと拒否', () => {
    expect(updateMasterSchema.safeParse({}).success).toBe(false);
    expect(updateMasterSchema.safeParse({ sortOrder: 3 }).success).toBe(true);
  });

  it('hireYear は 1950〜現在年+1 の整数のみ', () => {
    expect(hireYearSchema.safeParse(2020).success).toBe(true);
    expect(hireYearSchema.safeParse(hireYearMax()).success).toBe(true);
    expect(hireYearSchema.safeParse(hireYearMax() + 1).success).toBe(false);
    expect(hireYearSchema.safeParse(1949).success).toBe(false);
    expect(hireYearSchema.safeParse(2020.5).success).toBe(false);
  });

  it('updateUserByAdminSchema は組織項目だけでも通り、null クリアも可', () => {
    expect(updateUserByAdminSchema.safeParse({ hireYear: 2020 }).success).toBe(true);
    expect(updateUserByAdminSchema.safeParse({ departmentId: null, positionId: null, hireYear: null }).success).toBe(true);
    expect(updateUserByAdminSchema.safeParse({}).success).toBe(false);
    expect(updateUserByAdminSchema.safeParse({ departmentId: 'not-uuid' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/shared test`
Expected: FAIL（`./profile` が存在しない）。

- [ ] **Step 3: 実装**

`packages/shared/src/schemas/profile.ts`:

```ts
import { z } from 'zod';

export const HIRE_YEAR_MIN = 1950;
/** 内定者の事前登録を許容するため上限は「現在年 + 1」。parse 時点の年で評価する */
export const hireYearMax = () => new Date().getFullYear() + 1;

export const hireYearSchema = z
  .number()
  .int()
  .min(HIRE_YEAR_MIN)
  .refine((y) => y <= hireYearMax(), { message: '入社年が大きすぎます' });

const masterNameSchema = z.string().trim().min(1, '名称を入力してください').max(50);

export const createMasterSchema = z.object({ name: masterNameSchema });
export const updateMasterSchema = z
  .object({
    name: masterNameSchema.optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => v.name !== undefined || v.sortOrder !== undefined, {
    message: '変更内容を指定してください',
  });
```

`packages/shared/src/schemas/auth.ts` の `updateUserByAdminSchema` を置き換え（ファイル先頭に `import { hireYearSchema } from './profile';` を追加）:

```ts
export const updateUserByAdminSchema = z
  .object({
    role: z.enum(['member', 'admin']).optional(),
    isActive: z.boolean().optional(),
    departmentId: z.string().uuid().nullable().optional(),
    positionId: z.string().uuid().nullable().optional(),
    hireYear: hireYearSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: '変更内容を指定してください',
  });
```

`packages/shared/src/errors.ts` の ERROR_CODES 配列の `'CONFLICT', 'CATEGORY_NOT_EMPTY',` 行に `'CSV_IMPORT_FAILED',` を追加。

`packages/shared/src/index.ts` に `export * from './schemas/profile';` を追加。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/shared test && pnpm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): add org master and hire-year schemas"
```

---

### Task 3: マスタ CRUD サービス（master-service）

**Files:**
- Create: `apps/server/src/services/master-service.ts`
- Test: `apps/server/src/services/master-service.test.ts`

**Interfaces:**
- Produces: `type Master = { id: string; name: string; sortOrder: number }` と、departments / positions それぞれの
  `listDepartments(db): Promise<Master[]>` / `createDepartment(db, name): Promise<Master>` / `updateDepartment(db, id, patch: { name?: string; sortOrder?: number }): Promise<Master>` / `deleteDepartment(db, id): Promise<void>`、および同シグネチャの `listPositions` / `createPosition` / `updatePosition` / `deletePosition`。
- 重複 name は `AppError('CONFLICT', …, 409)`、対象なしは `AppError('NOT_FOUND', …, 404)`。

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/master-service.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createDepartment, createPosition, deleteDepartment, listDepartments, updateDepartment,
} from './master-service';

describe('master service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('作成すると sortOrder は末尾に採番され、sortOrder→name 順で返す', async () => {
    const a = await createDepartment(ctx.db, '開発部');
    const b = await createDepartment(ctx.db, '営業部');
    expect(a.sortOrder).toBe(0);
    expect(b.sortOrder).toBe(1);
    await updateDepartment(ctx.db, b.id, { sortOrder: 0 });
    const list = await listDepartments(ctx.db);
    expect(list.map((d) => d.name)).toEqual(['営業部', '開発部']);
  });

  it('同名の作成・改名は CONFLICT', async () => {
    await createDepartment(ctx.db, '開発部');
    await expect(createDepartment(ctx.db, '開発部')).rejects.toMatchObject({ code: 'CONFLICT' });
    const b = await createDepartment(ctx.db, '営業部');
    await expect(updateDepartment(ctx.db, b.id, { name: '開発部' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('削除すると割当済みユーザーの departmentId は null に戻る', async () => {
    const dep = await createDepartment(ctx.db, '開発部');
    const user = await createTestUser(ctx.db, { departmentId: dep.id });
    await deleteDepartment(ctx.db, dep.id);
    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(row.departmentId).toBeNull();
  });

  it('存在しない id の更新・削除は NOT_FOUND', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    await expect(updateDepartment(ctx.db, missing, { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteDepartment(ctx.db, missing)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('positions も同じ挙動（作成の採番）', async () => {
    const p = await createPosition(ctx.db, '部長');
    expect(p).toMatchObject({ name: '部長', sortOrder: 0 });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/server test -- master-service`
Expected: FAIL（`./master-service` が存在しない）。

- [ ] **Step 3: 実装**

`apps/server/src/services/master-service.ts`（departments / positions はテーブル名の型が異なり Drizzle のユニオン型が煩雑になるため、素直に 2 系統を明示実装する）:

```ts
import { asc, eq, sql } from 'drizzle-orm';
import { departments, positions } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';

export type Master = { id: string; name: string; sortOrder: number };

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

// ---- departments ----

export async function listDepartments(db: Db): Promise<Master[]> {
  return db
    .select({ id: departments.id, name: departments.name, sortOrder: departments.sortOrder })
    .from(departments)
    .orderBy(asc(departments.sortOrder), asc(departments.name));
}

export async function createDepartment(db: Db, name: string): Promise<Master> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${departments.sortOrder}), -1) + 1` })
    .from(departments);
  try {
    const [row] = await db.insert(departments).values({ name, sortOrder: next }).returning();
    return { id: row.id, name: row.name, sortOrder: row.sortOrder };
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError('CONFLICT', '同名の所属が既に存在します', 409);
    throw e;
  }
}

export async function updateDepartment(
  db: Db,
  id: string,
  patch: { name?: string; sortOrder?: number },
): Promise<Master> {
  try {
    const [row] = await db.update(departments).set(patch).where(eq(departments.id, id)).returning();
    if (!row) throw new AppError('NOT_FOUND', '所属が見つかりません', 404);
    return { id: row.id, name: row.name, sortOrder: row.sortOrder };
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError('CONFLICT', '同名の所属が既に存在します', 409);
    throw e;
  }
}

export async function deleteDepartment(db: Db, id: string): Promise<void> {
  const rows = await db.delete(departments).where(eq(departments.id, id)).returning({ id: departments.id });
  if (rows.length === 0) throw new AppError('NOT_FOUND', '所属が見つかりません', 404);
}

// ---- positions ----

export async function listPositions(db: Db): Promise<Master[]> {
  return db
    .select({ id: positions.id, name: positions.name, sortOrder: positions.sortOrder })
    .from(positions)
    .orderBy(asc(positions.sortOrder), asc(positions.name));
}

export async function createPosition(db: Db, name: string): Promise<Master> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${positions.sortOrder}), -1) + 1` })
    .from(positions);
  try {
    const [row] = await db.insert(positions).values({ name, sortOrder: next }).returning();
    return { id: row.id, name: row.name, sortOrder: row.sortOrder };
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError('CONFLICT', '同名の役職が既に存在します', 409);
    throw e;
  }
}

export async function updatePosition(
  db: Db,
  id: string,
  patch: { name?: string; sortOrder?: number },
): Promise<Master> {
  try {
    const [row] = await db.update(positions).set(patch).where(eq(positions.id, id)).returning();
    if (!row) throw new AppError('NOT_FOUND', '役職が見つかりません', 404);
    return { id: row.id, name: row.name, sortOrder: row.sortOrder };
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError('CONFLICT', '同名の役職が既に存在します', 409);
    throw e;
  }
}

export async function deletePosition(db: Db, id: string): Promise<void> {
  const rows = await db.delete(positions).where(eq(positions.id, id)).returning({ id: positions.id });
  if (rows.length === 0) throw new AppError('NOT_FOUND', '役職が見つかりません', 404);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test -- master-service`
Expected: PASS（5 テスト）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/master-service.ts apps/server/src/services/master-service.test.ts
git commit -m "feat(server): add department/position master service"
```

---

### Task 4: admin ルートにマスタ CRUD を追加

**Files:**
- Modify: `apps/server/src/routes/admin.ts`

**Interfaces:**
- Consumes: Task 3 の master-service 8 関数、Task 2 の `createMasterSchema` / `updateMasterSchema`。
- Produces: `GET/POST /api/admin/departments`、`PATCH/DELETE /api/admin/departments/:id`、同形の `/api/admin/positions`。すべて `requireAuth, requireCan('user:manage')` 配下（ファイル先頭の `.use()` が適用済み）。

- [ ] **Step 1: ルートを実装**

`apps/server/src/routes/admin.ts` に import を追加:

```ts
import { createMasterSchema, updateMasterSchema } from '@knowledge-hub/shared';
import {
  createDepartment, createPosition, deleteDepartment, deletePosition,
  listDepartments, listPositions, updateDepartment, updatePosition,
} from '../services/master-service';
```

`adminRoutes` のチェーン末尾（`.patch('/users/:id', …)` の後）に追加:

```ts
  .get('/departments', async (c) => c.json(await listDepartments(c.get('db'))))
  .post('/departments', validate('json', createMasterSchema), async (c) =>
    c.json(await createDepartment(c.get('db'), c.req.valid('json').name), 201))
  .patch('/departments/:id', validate('json', updateMasterSchema), async (c) => {
    requireUuidParam(c.req.param('id'), '所属が見つかりません');
    return c.json(await updateDepartment(c.get('db'), c.req.param('id'), c.req.valid('json')));
  })
  .delete('/departments/:id', async (c) => {
    requireUuidParam(c.req.param('id'), '所属が見つかりません');
    await deleteDepartment(c.get('db'), c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/positions', async (c) => c.json(await listPositions(c.get('db'))))
  .post('/positions', validate('json', createMasterSchema), async (c) =>
    c.json(await createPosition(c.get('db'), c.req.valid('json').name), 201))
  .patch('/positions/:id', validate('json', updateMasterSchema), async (c) => {
    requireUuidParam(c.req.param('id'), '役職が見つかりません');
    return c.json(await updatePosition(c.get('db'), c.req.param('id'), c.req.valid('json')));
  })
  .delete('/positions/:id', async (c) => {
    requireUuidParam(c.req.param('id'), '役職が見つかりません');
    await deletePosition(c.get('db'), c.req.param('id'));
    return c.body(null, 204);
  })
```

- [ ] **Step 2: 型チェックと既存の admin ルートテストで回帰確認**

Run: `pnpm --filter @knowledge-hub/server typecheck && pnpm --filter @knowledge-hub/server test -- routes/admin`
Expected: PASS（認可・エラー整形は既存ミドルウェアとサービステストでカバー済み。ルート固有ロジックは薄いラッパのみ）。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/routes/admin.ts
git commit -m "feat(server): add admin CRUD routes for org masters"
```

---

### Task 5: user-service 拡張（admin 一覧 / admin 更新 / 公開プロフィール）

**Files:**
- Modify: `apps/server/src/services/user-service.ts`
- Test: `apps/server/src/services/user-service.test.ts`（既存に追記）

**Interfaces:**
- Consumes: Task 1 のカラム、Task 3 のマスタ（テスト用）。
- Produces:
  - `AdminUserView` に `departmentId: string | null` / `positionId: string | null` / `hireYear: number | null` を追加。
  - `updateUserByAdmin` の patch に同 3 項目（null でクリア）。存在しない departmentId / positionId は `AppError('VALIDATION', …, 400)`。
  - `PublicProfile` に `department: { id, name } | null` / `position: { id, name } | null` / `hireYear: number | null` を追加（`getPublicProfile` が JOIN で返す）。

- [ ] **Step 1: 失敗するテストを追記**

`apps/server/src/services/user-service.test.ts` に追加（既存の describe 内、`createTestUser` / `createTestApp` は既存 import を利用。`createDepartment` / `createPosition` の import を追加）:

```ts
import { createDepartment, createPosition } from './master-service';

  it('admin 更新で所属・役職・入社年を設定/クリアでき、一覧・公開プロフィールに出る', async () => {
    const dep = await createDepartment(ctx.db, '開発部');
    const pos = await createPosition(ctx.db, '部長');
    const user = await createTestUser(ctx.db);

    const updated = await updateUserByAdmin(ctx.db, user.id, {
      departmentId: dep.id, positionId: pos.id, hireYear: 2020,
    });
    expect(updated).toMatchObject({ departmentId: dep.id, positionId: pos.id, hireYear: 2020 });

    const profile = await getPublicProfile(ctx.db, user.id);
    expect(profile.department).toEqual({ id: dep.id, name: '開発部' });
    expect(profile.position).toEqual({ id: pos.id, name: '部長' });
    expect(profile.hireYear).toBe(2020);

    const list = await listUsers(ctx.db);
    expect(list.find((u) => u.id === user.id)).toMatchObject({ departmentId: dep.id, hireYear: 2020 });

    const cleared = await updateUserByAdmin(ctx.db, user.id, {
      departmentId: null, positionId: null, hireYear: null,
    });
    expect(cleared).toMatchObject({ departmentId: null, positionId: null, hireYear: null });
  });

  it('存在しない所属/役職の割当は VALIDATION', async () => {
    const user = await createTestUser(ctx.db);
    const missing = '00000000-0000-0000-0000-000000000000';
    await expect(
      updateUserByAdmin(ctx.db, user.id, { departmentId: missing }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      updateUserByAdmin(ctx.db, user.id, { positionId: missing }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
```

（既存テストの import に `getPublicProfile` / `listUsers` / `updateUserByAdmin` が無ければ追加する。）

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/server test -- user-service`
Expected: FAIL（型エラー: patch に departmentId が無い / PublicProfile に department が無い）。

- [ ] **Step 3: 実装**

`apps/server/src/services/user-service.ts` を変更する。

import を追加:

```ts
import { departments, positions, uploads, users } from '../db/schema';
```

`AdminUserView` と `toAdminView` を拡張:

```ts
export type AdminUserView = {
  id: string;
  email: string;
  displayName: string;
  role: 'member' | 'admin';
  authProvider: 'oidc' | 'password';
  isActive: boolean;
  createdAt: Date;
  avatarUrl: string | null;
  departmentId: string | null;
  positionId: string | null;
  hireYear: number | null;
};

function toAdminView(row: typeof users.$inferSelect): AdminUserView {
  const {
    id, email, displayName, role, authProvider, isActive, createdAt, avatarUrl,
    departmentId, positionId, hireYear,
  } = row;
  return {
    id, email, displayName, role, authProvider, isActive, createdAt, avatarUrl,
    departmentId, positionId, hireYear,
  };
}
```

`updateUserByAdmin` のシグネチャと存在チェック（トランザクション内、target 取得の直後に追加）:

```ts
export async function updateUserByAdmin(
  db: Db,
  targetId: string,
  patch: {
    role?: 'member' | 'admin';
    isActive?: boolean;
    departmentId?: string | null;
    positionId?: string | null;
    hireYear?: number | null;
  },
): Promise<AdminUserView> {
```

target の NOT_FOUND チェックの直後:

```ts
    // FK 違反を 500 にせず、割当先の実在をアプリ層で 400 にする
    if (patch.departmentId) {
      const dep = await tx.query.departments.findFirst({
        where: eq(departments.id, patch.departmentId), columns: { id: true },
      });
      if (!dep) throw new AppError('VALIDATION', '所属が存在しません', 400);
    }
    if (patch.positionId) {
      const pos = await tx.query.positions.findFirst({
        where: eq(positions.id, patch.positionId), columns: { id: true },
      });
      if (!pos) throw new AppError('VALIDATION', '役職が存在しません', 400);
    }
```

`PublicProfile` と `getPublicProfile` を置き換え:

```ts
export type PublicProfile = {
  id: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  hireYear: number | null;
};

export async function getPublicProfile(db: Db, id: string): Promise<PublicProfile> {
  // UUID 形式の検証はルート層（requireUuidParam）に一元化した。
  const [row] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      bio: users.bio,
      avatarUrl: users.avatarUrl,
      hireYear: users.hireYear,
      departmentId: departments.id,
      departmentName: departments.name,
      positionId: positions.id,
      positionName: positions.name,
    })
    .from(users)
    .leftJoin(departments, eq(users.departmentId, departments.id))
    .leftJoin(positions, eq(users.positionId, positions.id))
    .where(eq(users.id, id));
  if (!row) throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);
  return {
    id: row.id,
    displayName: row.displayName,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    hireYear: row.hireYear,
    department: row.departmentId ? { id: row.departmentId, name: row.departmentName! } : null,
    position: row.positionId ? { id: row.positionId, name: row.positionName! } : null,
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test -- user-service`
Expected: PASS（追加 2 テスト + 既存の回帰）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/user-service.ts apps/server/src/services/user-service.test.ts
git commit -m "feat(server): manage user org fields via admin update"
```

---

### Task 6: profiles サービスとルート（GET /api/profiles）

**Files:**
- Create: `apps/server/src/services/profile-service.ts`
- Test: `apps/server/src/services/profile-service.test.ts`
- Create: `apps/server/src/routes/profiles.ts`
- Modify: `apps/server/src/app.ts`（`.route('/api/profiles', profileRoutes)` 追加）

**Interfaces:**
- Consumes: Task 3 の `listDepartments` / `listPositions` / `Master`。
- Produces:
  ```ts
  export type ProfileItem = {
    id: string; displayName: string; avatarUrl: string | null; bio: string;
    department: { id: string; name: string } | null;
    position: { id: string; name: string } | null;
    hireYear: number | null;
  };
  export type ProfilesResponse = { users: ProfileItem[]; departments: Master[]; positions: Master[] };
  export function listProfiles(db: Db): Promise<ProfilesResponse>;
  ```
  ルート: `GET /api/profiles`（requireAuth のみ、管理者不要）。Web は hc 経由でこの型を推論する。

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/profile-service.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createDepartment, createPosition } from './master-service';
import { listProfiles } from './profile-service';

describe('profile service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('有効ユーザーのみを表示名順で返し、マスタも同梱する', async () => {
    const dep = await createDepartment(ctx.db, '開発部');
    const pos = await createPosition(ctx.db, '部長');
    await createTestUser(ctx.db, { displayName: 'いろは', departmentId: dep.id, positionId: pos.id, hireYear: 2018 });
    await createTestUser(ctx.db, { displayName: 'あいう' });
    await createTestUser(ctx.db, { displayName: '退職者', isActive: false });

    const res = await listProfiles(ctx.db);
    expect(res.users.map((u) => u.displayName)).toEqual(['あいう', 'いろは']);
    expect(res.users[1]).toMatchObject({
      department: { id: dep.id, name: '開発部' },
      position: { id: pos.id, name: '部長' },
      hireYear: 2018,
    });
    expect(res.users[0]).toMatchObject({ department: null, position: null, hireYear: null });
    expect(res.departments).toHaveLength(1);
    expect(res.positions).toHaveLength(1);
  });

  it('email など非公開情報を含めない', async () => {
    await createTestUser(ctx.db);
    const res = await listProfiles(ctx.db);
    expect(Object.keys(res.users[0]).sort()).toEqual(
      ['avatarUrl', 'bio', 'department', 'displayName', 'hireYear', 'id', 'position'].sort(),
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/server test -- profile-service`
Expected: FAIL（`./profile-service` が存在しない）。

- [ ] **Step 3: サービスを実装**

`apps/server/src/services/profile-service.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import { departments, positions, users } from '../db/schema';
import type { Db } from '../types';
import { listDepartments, listPositions, type Master } from './master-service';

/** メンバー名簿の 1 件。email 等の非公開情報は絶対に含めない。 */
export type ProfileItem = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  hireYear: number | null;
};

export type ProfilesResponse = {
  users: ProfileItem[];
  departments: Master[];
  positions: Master[];
};

// 名簿規模（数百人）を想定し全件返す。検索・絞り込み・並び替えはクライアント側。
// 千人規模になったらサーバーサイドのフィルタ/ページングを検討する（spec 参照）。
export async function listProfiles(db: Db): Promise<ProfilesResponse> {
  const [rows, deps, poss] = await Promise.all([
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        bio: users.bio,
        hireYear: users.hireYear,
        departmentId: departments.id,
        departmentName: departments.name,
        positionId: positions.id,
        positionName: positions.name,
      })
      .from(users)
      .leftJoin(departments, eq(users.departmentId, departments.id))
      .leftJoin(positions, eq(users.positionId, positions.id))
      .where(eq(users.isActive, true))
      .orderBy(asc(users.displayName)),
    listDepartments(db),
    listPositions(db),
  ]);
  return {
    users: rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      bio: r.bio,
      hireYear: r.hireYear,
      department: r.departmentId ? { id: r.departmentId, name: r.departmentName! } : null,
      position: r.positionId ? { id: r.positionId, name: r.positionName! } : null,
    })),
    departments: deps,
    positions: poss,
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test -- profile-service`
Expected: PASS。

- [ ] **Step 5: ルートを追加**

`apps/server/src/routes/profiles.ts`:

```ts
import { Hono } from 'hono';
import { requireAuth } from '../middleware/session';
import { listProfiles } from '../services/profile-service';
import type { AppEnv } from '../types';

export const profileRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', async (c) => c.json(await listProfiles(c.get('db'))));
```

`apps/server/src/app.ts` に import `import { profileRoutes } from './routes/profiles';` と、`.route('/api/users', userRoutes)` の次の行に `.route('/api/profiles', profileRoutes)` を追加。

- [ ] **Step 6: 型チェック + Commit**

Run: `pnpm --filter @knowledge-hub/server typecheck`
Expected: PASS。

```bash
git add apps/server/src/services/profile-service.ts apps/server/src/services/profile-service.test.ts apps/server/src/routes/profiles.ts apps/server/src/app.ts
git commit -m "feat(server): add member profiles listing endpoint"
```

---

### Task 7: CSV パーサ（RFC 4180 準拠の最小実装）

**Files:**
- Create: `apps/server/src/services/csv.ts`
- Test: `apps/server/src/services/csv.test.ts`

**Interfaces:**
- Produces: `parseCsv(text: string): string[][]` — BOM 除去、`"` クォート（`""` エスケープ・クォート内カンマ / 改行）、CRLF / LF、末尾改行と空行の除去に対応。依存追加なし（`pnpm audit` を汚さない）。

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('基本のカンマ区切りと LF/CRLF を解釈する', () => {
    expect(parseCsv('a,b,c\n1,2,3\r\n4,5,6')).toEqual([
      ['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6'],
    ]);
  });

  it('クォート内のカンマ・改行・"" エスケープを解釈する', () => {
    expect(parseCsv('a,"b,1","c\n2"\n"say ""hi""",x,y')).toEqual([
      ['a', 'b,1', 'c\n2'], ['say "hi"', 'x', 'y'],
    ]);
  });

  it('BOM・末尾改行・空行を無視する', () => {
    expect(parseCsv('\uFEFFa,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('空文字列は空配列', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/server test -- services/csv`
Expected: FAIL（`./csv` が存在しない）。

- [ ] **Step 3: 実装**

`apps/server/src/services/csv.ts`:

```ts
/**
 * RFC 4180 準拠の最小 CSV パーサ。外部依存を増やさないための自前実装。
 * BOM 除去・ダブルクォート（"" エスケープ、クォート内カンマ/改行）・CRLF/LF 対応。
 * 空行（全フィールドが空白のみの 1 フィールド行）は取り除く。
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r' && src[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 2; continue; }
    if (ch === '\n' || ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += ch; i += 1;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test -- services/csv`
Expected: PASS（4 テスト）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/csv.ts apps/server/src/services/csv.test.ts
git commit -m "feat(server): add minimal RFC 4180 CSV parser"
```

---

### Task 8: CSV インポートサービス（all-or-nothing）

**Files:**
- Create: `apps/server/src/services/user-import-service.ts`
- Test: `apps/server/src/services/user-import-service.test.ts`

**Interfaces:**
- Consumes: Task 7 の `parseCsv`、Task 2 の `HIRE_YEAR_MIN` / `hireYearMax`。
- Produces:
  ```ts
  export type ImportError = { line: number; email?: string; message: string };
  export type ImportResult =
    | { ok: true; updated: number; createdDepartments: string[]; createdPositions: string[] }
    | { ok: false; errors: ImportError[] };
  export function importUserOrg(db: Db, csvText: string): Promise<ImportResult>;
  ```
  仕様: ヘッダー行 `email,department,position,hire_year` 必須。空欄はクリア（null）。未知の所属・役職名は trim 後の完全一致で照合し、無ければ作成（sortOrder は末尾）。1 件でもエラーなら `ok: false` で何も適用しない。適用は単一トランザクション。

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/user-import-service.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createDepartment, listDepartments, listPositions } from './master-service';
import { importUserOrg } from './user-import-service';

describe('user import service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('更新・空欄クリア・マスタ自動作成（既存は再利用）を行う', async () => {
    await createDepartment(ctx.db, '開発部'); // 既存マスタ → 再利用される
    const a = await createTestUser(ctx.db, { email: 'a@example.com', hireYear: 2000 });
    const b = await createTestUser(ctx.db, { email: 'b@example.com' });

    const csv = [
      'email,department,position,hire_year',
      'a@example.com,開発部,部長,2018',
      'b@example.com,,,',
    ].join('\n');
    const result = await importUserOrg(ctx.db, csv);
    expect(result).toEqual({
      ok: true, updated: 2, createdDepartments: [], createdPositions: ['部長'],
    });

    const [rowA] = await ctx.db.select().from(users).where(eq(users.id, a.id));
    expect(rowA.hireYear).toBe(2018);
    expect(rowA.departmentId).not.toBeNull();
    expect(rowA.positionId).not.toBeNull();
    const [rowB] = await ctx.db.select().from(users).where(eq(users.id, b.id));
    expect(rowB).toMatchObject({ departmentId: null, positionId: null, hireYear: null });
    expect(await listDepartments(ctx.db)).toHaveLength(1);
    expect(await listPositions(ctx.db)).toHaveLength(1);
  });

  it('1 行でもエラーがあれば何も適用しない（all-or-nothing）', async () => {
    const a = await createTestUser(ctx.db, { email: 'a@example.com' });
    const csv = [
      'email,department,position,hire_year',
      'a@example.com,開発部,,2018',
      'unknown@example.com,営業部,,2019',
      'a@example.com,,,abc',
    ].join('\n');
    const result = await importUserOrg(ctx.db, csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // 未知メール(3行目)・メール重複(4行目)。重複行は hire_year 検証前に打ち切るため 1 件のみ
    expect(result.errors.map((e) => e.line)).toEqual([3, 4]);

    const [rowA] = await ctx.db.select().from(users).where(eq(users.id, a.id));
    expect(rowA.departmentId).toBeNull();
    expect(await listDepartments(ctx.db)).toHaveLength(0);
  });

  it('ヘッダー不正・列数不一致・空 CSV を弾く', async () => {
    const bad = await importUserOrg(ctx.db, 'email,dept\nx@example.com,a');
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('unreachable');
    expect(bad.errors[0].line).toBe(1);

    const shortRow = await importUserOrg(
      ctx.db, 'email,department,position,hire_year\nx@example.com,a,b',
    );
    expect(shortRow.ok).toBe(false);

    const empty = await importUserOrg(ctx.db, '');
    expect(empty.ok).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/server test -- user-import-service`
Expected: FAIL（`./user-import-service` が存在しない）。

- [ ] **Step 3: 実装**

`apps/server/src/services/user-import-service.ts`:

```ts
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test -- user-import-service`
Expected: PASS（3 テスト）。

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/user-import-service.ts apps/server/src/services/user-import-service.test.ts
git commit -m "feat(server): add all-or-nothing CSV import for user org fields"
```

---

### Task 9: CSV インポートルート（POST /api/admin/users/import）

**Files:**
- Modify: `apps/server/src/routes/admin.ts`

**Interfaces:**
- Consumes: Task 8 の `importUserOrg`。
- Produces: `POST /api/admin/users/import`（multipart/form-data、フィールド名 `file`）。成功時 200 `{ updated, createdDepartments, createdPositions }`、エラー時 400 `{ code: 'CSV_IMPORT_FAILED', message, details: ImportError[] }`（`ApiError` 形。AppError は details を持てないためルートで直接整形する）。ファイル未指定は `AppError('VALIDATION', …, 400)`。

- [ ] **Step 1: ルートを実装**

`apps/server/src/routes/admin.ts` に import を追加:

```ts
import { AppError } from '../errors';
import { importUserOrg } from '../services/user-import-service';
```

チェーンの `.patch('/users/:id', …)` の直後に追加:

```ts
  .post('/users/import', async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION', 'CSV ファイルを file フィールドで指定してください', 400);
    }
    const result = await importUserOrg(c.get('db'), await file.text());
    if (!result.ok) {
      return c.json(
        { code: 'CSV_IMPORT_FAILED' as const, message: 'CSV にエラーがあります', details: result.errors },
        400,
      );
    }
    const { ok: _ok, ...summary } = result;
    return c.json(summary);
  })
```

- [ ] **Step 2: 型チェック + サーバーテスト全体で回帰確認**

Run: `pnpm --filter @knowledge-hub/server typecheck && pnpm --filter @knowledge-hub/server test`
Expected: PASS（インポートのロジックは Task 8 のサービステストでカバー。multipart の疎通は Task 13 の Web テストと Task 15 の E2E で確認する）。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/routes/admin.ts
git commit -m "feat(server): add admin CSV import endpoint"
```

---

### Task 10: Web の queryKey とデータフック（profiles / マスタ）

**Files:**
- Modify: `apps/web/src/api/keys.ts`
- Create: `apps/web/src/api/profiles.ts`
- Create: `apps/web/src/api/admin-masters.ts`

**Interfaces:**
- Produces:
  - `keys.profiles`、`keys.adminDepartments`、`keys.adminPositions`。
  - `useProfiles()` — `GET /api/profiles` の useQuery。`ProfileItem` / `ProfileMaster` / `ProfilesData` 型を export。
  - `useMasters(kind: 'departments' | 'positions')` と `useMasterMutations(kind)`（create / update / remove の useMutation。成功時に該当 keys と `keys.profiles` を invalidate）。

- [ ] **Step 1: keys.ts にキーを追加**

`apps/web/src/api/keys.ts` の `adminUsers` 行の後に追加:

```ts
  profiles: ['profiles'] as const,
  adminDepartments: ['admin-departments'] as const,
  adminPositions: ['admin-positions'] as const,
```

- [ ] **Step 2: profiles フックを実装**

`apps/web/src/api/profiles.ts`（`api/categories.ts` の型宣言スタイルを踏襲）:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { keys } from './keys';

// GET /api/profiles のレスポンス型（サーバー profile-service.ts の ProfilesResponse と対応）
export type ProfileMaster = { id: string; name: string; sortOrder: number };
export type ProfileItem = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  hireYear: number | null;
};
export type ProfilesData = {
  users: ProfileItem[];
  departments: ProfileMaster[];
  positions: ProfileMaster[];
};

export function useProfiles() {
  return useQuery({
    queryKey: keys.profiles,
    queryFn: async (): Promise<ProfilesData> => {
      const res = await api.api.profiles.$get();
      if (!res.ok) throw new Error('failed');
      return (await res.json()) as ProfilesData;
    },
  });
}
```

- [ ] **Step 3: マスタ管理フックを実装**

`apps/web/src/api/admin-masters.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { errorMessage } from '../lib/api-error';
import { keys } from './keys';
import type { ProfileMaster } from './profiles';

export type MasterKind = 'departments' | 'positions';

const routes = {
  departments: api.api.admin.departments,
  positions: api.api.admin.positions,
} as const;

const keyOf = (kind: MasterKind) =>
  kind === 'departments' ? keys.adminDepartments : keys.adminPositions;

export function useMasters(kind: MasterKind) {
  return useQuery({
    queryKey: keyOf(kind),
    queryFn: async (): Promise<ProfileMaster[]> => {
      const res = await routes[kind].$get();
      if (!res.ok) throw new Error('failed');
      return (await res.json()) as ProfileMaster[];
    },
  });
}

export function useMasterMutations(kind: MasterKind) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keyOf(kind) });
    queryClient.invalidateQueries({ queryKey: keys.profiles });
    queryClient.invalidateQueries({ queryKey: keys.adminUsers });
  };
  const create = useMutation({
    mutationFn: async (name: string) => {
      const res = await routes[kind].$post({ json: { name } });
      if (!res.ok) throw new Error(await errorMessage(res, '追加に失敗しました'));
    },
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: async (input: { id: string; name?: string; sortOrder?: number }) => {
      const { id, ...json } = input;
      const res = await routes[kind][':id'].$patch({ param: { id }, json });
      if (!res.ok) throw new Error(await errorMessage(res, '更新に失敗しました'));
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await routes[kind][':id'].$delete({ param: { id } });
      if (!res.ok) throw new Error(await errorMessage(res, '削除に失敗しました'));
    },
    onSuccess: invalidate,
  });
  return { create, update, remove };
}
```

- [ ] **Step 4: 型チェック**

Run: `pnpm --filter @knowledge-hub/web typecheck`
Expected: PASS（hc の型推論でルートの存在が検証される）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/keys.ts apps/web/src/api/profiles.ts apps/web/src/api/admin-masters.ts
git commit -m "feat(web): add profiles and org master data hooks"
```

---

### Task 11: メンバー一覧ページ（/members）

**Files:**
- Create: `apps/web/src/pages/ProfilesPage.tsx`
- Test: `apps/web/src/pages/ProfilesPage.test.tsx`
- Modify: `apps/web/src/App.tsx`（import + `/members` ルート）
- Modify: `apps/web/src/components/Sidebar.tsx`（「メンバー」リンク追加）

**Interfaces:**
- Consumes: Task 10 の `useProfiles` / `ProfileItem` / `ProfileMaster` / `ProfilesData`。
- Produces: `/members` ルート（RequireAuth 配下）。検索（表示名部分一致）・絞り込み（所属 / 役職 / 入社年、AND）・並び替え（名前 / 所属 / 役職 / 入社年昇降）。カードクリックで `/users/:id`。

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/pages/ProfilesPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    api: {
      profiles: {
        $get: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            users: [
              { id: '1', displayName: '佐藤花子', avatarUrl: null, bio: '',
                department: { id: 'd1', name: '開発部' }, position: { id: 'p1', name: '部長' }, hireYear: 2015 },
              { id: '2', displayName: '鈴木一郎', avatarUrl: null, bio: '',
                department: { id: 'd2', name: '営業部' }, position: { id: 'p2', name: 'メンバー' }, hireYear: 2021 },
              { id: '3', displayName: '高橋未設定', avatarUrl: null, bio: '',
                department: null, position: null, hireYear: null },
            ],
            departments: [
              { id: 'd1', name: '開発部', sortOrder: 0 },
              { id: 'd2', name: '営業部', sortOrder: 1 },
            ],
            positions: [
              { id: 'p1', name: '部長', sortOrder: 0 },
              { id: 'p2', name: 'メンバー', sortOrder: 1 },
            ],
          }),
        }),
      },
    },
  },
}));

import { ProfilesPage } from './ProfilesPage';

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><ProfilesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProfilesPage', () => {
  it('全員をカード表示し、件数を出す', async () => {
    renderPage();
    expect(await screen.findByText('佐藤花子')).toBeInTheDocument();
    expect(screen.getByText('鈴木一郎')).toBeInTheDocument();
    expect(screen.getByText('3 人')).toBeInTheDocument();
  });

  it('名前で検索できる', async () => {
    renderPage();
    await screen.findByText('佐藤花子');
    await userEvent.type(screen.getByRole('searchbox', { name: '名前で検索' }), '鈴木');
    expect(screen.queryByText('佐藤花子')).not.toBeInTheDocument();
    expect(screen.getByText('鈴木一郎')).toBeInTheDocument();
  });

  it('所属で絞り込める（未設定ユーザーは出ない）', async () => {
    renderPage();
    await screen.findByText('佐藤花子');
    await userEvent.selectOptions(screen.getByLabelText('所属'), 'd1');
    expect(screen.getByText('佐藤花子')).toBeInTheDocument();
    expect(screen.queryByText('鈴木一郎')).not.toBeInTheDocument();
    expect(screen.queryByText('高橋未設定')).not.toBeInTheDocument();
  });

  it('役職順の並び替えは sortOrder 順、未設定は末尾', async () => {
    renderPage();
    await screen.findByText('佐藤花子');
    await userEvent.selectOptions(screen.getByLabelText('並び替え'), 'position');
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['佐藤花子', '鈴木一郎', '高橋未設定']);
  });

  it('入社年の降順で並び替えられる', async () => {
    renderPage();
    await screen.findByText('佐藤花子');
    await userEvent.selectOptions(screen.getByLabelText('並び替え'), 'hireYearDesc');
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['鈴木一郎', '佐藤花子', '高橋未設定']);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/web test -- ProfilesPage`
Expected: FAIL（`./ProfilesPage` が存在しない）。

- [ ] **Step 3: ページを実装**

`apps/web/src/pages/ProfilesPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useProfiles, type ProfileItem, type ProfileMaster } from '../api/profiles';
import { Avatar } from '../components/Avatar';
import { ErrorState } from '../components/ErrorState';
import { Loading } from '../components/Loading';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SortKey = 'name' | 'department' | 'position' | 'hireYearAsc' | 'hireYearDesc';

const collator = new Intl.Collator('ja');

// マスタ sortOrder 順 → 同順位は名前順。未設定（null）は末尾。
function byMaster(orderOf: Map<string, number>, pick: (u: ProfileItem) => { id: string } | null) {
  return (a: ProfileItem, b: ProfileItem) => {
    const oa = pick(a) ? orderOf.get(pick(a)!.id)! : Number.POSITIVE_INFINITY;
    const ob = pick(b) ? orderOf.get(pick(b)!.id)! : Number.POSITIVE_INFINITY;
    return oa - ob || collator.compare(a.displayName, b.displayName);
  };
}

function byHireYear(dir: 1 | -1) {
  return (a: ProfileItem, b: ProfileItem) => {
    // null（未設定）は昇順・降順とも末尾に置く
    if (a.hireYear === null && b.hireYear === null) return collator.compare(a.displayName, b.displayName);
    if (a.hireYear === null) return 1;
    if (b.hireYear === null) return -1;
    return (a.hireYear - b.hireYear) * dir || collator.compare(a.displayName, b.displayName);
  };
}

function orderMap(masters: ProfileMaster[]): Map<string, number> {
  return new Map(masters.map((m, i) => [m.id, i]));
}

export function ProfilesPage() {
  const { data, isLoading, isError } = useProfiles();
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [hireYear, setHireYear] = useState('');
  const [sort, setSort] = useState<SortKey>('name');

  const users = useMemo(() => {
    if (!data) return [];
    const query = q.trim().toLowerCase();
    const filtered = data.users.filter((u) =>
      (query === '' || u.displayName.toLowerCase().includes(query)) &&
      (departmentId === '' || u.department?.id === departmentId) &&
      (positionId === '' || u.position?.id === positionId) &&
      (hireYear === '' || u.hireYear === Number(hireYear)),
    );
    const comparators: Record<SortKey, (a: ProfileItem, b: ProfileItem) => number> = {
      name: (a, b) => collator.compare(a.displayName, b.displayName),
      department: byMaster(orderMap(data.departments), (u) => u.department),
      position: byMaster(orderMap(data.positions), (u) => u.position),
      hireYearAsc: byHireYear(1),
      hireYearDesc: byHireYear(-1),
    };
    return [...filtered].sort(comparators[sort]);
  }, [data, q, departmentId, positionId, hireYear, sort]);

  const hireYears = useMemo(() => {
    const years = new Set<number>();
    for (const u of data?.users ?? []) if (u.hireYear !== null) years.add(u.hireYear);
    return [...years].sort((a, b) => b - a);
  }, [data]);

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState />;

  const selectClass =
    'h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs';

  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">メンバー</h2>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="member-search">名前で検索</Label>
          <Input
            id="member-search" type="search" value={q}
            onChange={(e) => setQ(e.target.value)} placeholder="表示名"
            className="w-48"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-department">所属</Label>
          <select id="filter-department" className={selectClass} value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">すべて</option>
            {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-position">役職</Label>
          <select id="filter-position" className={selectClass} value={positionId}
            onChange={(e) => setPositionId(e.target.value)}>
            <option value="">すべて</option>
            {data.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-hire-year">入社年</Label>
          <select id="filter-hire-year" className={selectClass} value={hireYear}
            onChange={(e) => setHireYear(e.target.value)}>
            <option value="">すべて</option>
            {hireYears.map((y) => <option key={y} value={y}>{y} 年</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sort-key">並び替え</Label>
          <select id="sort-key" className={selectClass} value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="name">名前順</option>
            <option value="department">所属順</option>
            <option value="position">役職順</option>
            <option value="hireYearAsc">入社年が古い順</option>
            <option value="hireYearDesc">入社年が新しい順</option>
          </select>
        </div>
        <p className="ml-auto text-sm text-muted-foreground">{users.length} 人</p>
      </div>

      {users.length === 0 ? (
        <p className="text-muted-foreground">該当するメンバーがいません。</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {users.map((u) => (
            <li key={u.id}>
              <Link to={`/users/${u.id}`} className="block h-full">
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-start gap-3 pt-4">
                    <Avatar src={u.avatarUrl} name={u.displayName} className="size-10" />
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{u.displayName}</h3>
                      <p className="text-sm text-muted-foreground">
                        {[u.department?.name, u.position?.name].filter(Boolean).join(' / ') || '所属・役職 未設定'}
                        {u.hireYear !== null && ` ・ ${u.hireYear} 年入社`}
                      </p>
                      {u.bio && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{u.bio}</p>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/web test -- ProfilesPage`
Expected: PASS（5 テスト）。

- [ ] **Step 5: ルートとサイドバーを追加**

`apps/web/src/App.tsx`: import に `import { ProfilesPage } from './pages/ProfilesPage';` を追加し、children の `{ path: '/search', … }` の次に:

```tsx
      { path: '/members', element: <ProfilesPage /> },
```

`apps/web/src/components/Sidebar.tsx`: `<Item to="/me/bookmarks" … />` の次の行に（`Users` は既に import 済みの lucide アイコン。無ければ import に追加）:

```tsx
        <Item to="/members" icon={Users} label="メンバー" onNavigate={onNavigate} />
```

- [ ] **Step 6: 型チェック + Commit**

Run: `pnpm --filter @knowledge-hub/web typecheck && pnpm --filter @knowledge-hub/web test`
Expected: PASS。

```bash
git add apps/web/src/pages/ProfilesPage.tsx apps/web/src/pages/ProfilesPage.test.tsx apps/web/src/App.tsx apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add members directory page with search/filter/sort"
```

---

### Task 12: マスタ管理ページ（/admin/masters）

**Files:**
- Create: `apps/web/src/pages/AdminMastersPage.tsx`
- Test: `apps/web/src/pages/AdminMastersPage.test.tsx`
- Modify: `apps/web/src/App.tsx`（`/admin/masters` ルート）
- Modify: `apps/web/src/components/Sidebar.tsx`（管理グループにリンク追加）

**Interfaces:**
- Consumes: Task 10 の `useMasters` / `useMasterMutations`。
- Produces: `/admin/masters`（RequireRole admin）。所属・役職それぞれの追加 / 改名 / 並び順変更（↑↓）/ 削除（confirm 付き）。

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/pages/AdminMastersPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const postDepartment = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
vi.mock('../api/client', () => ({
  api: {
    api: {
      admin: {
        departments: {
          $get: vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [
              { id: 'd1', name: '開発部', sortOrder: 0 },
              { id: 'd2', name: '営業部', sortOrder: 1 },
            ],
          }),
          $post: (...args: unknown[]) => postDepartment(...args),
          ':id': { $patch: vi.fn(), $delete: vi.fn() },
        },
        positions: {
          $get: vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [{ id: 'p1', name: '部長', sortOrder: 0 }],
          }),
          $post: vi.fn(),
          ':id': { $patch: vi.fn(), $delete: vi.fn() },
        },
      },
    },
  },
}));

import { AdminMastersPage } from './AdminMastersPage';

describe('AdminMastersPage', () => {
  it('所属・役職の一覧を表示し、追加フォームから作成できる', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminMastersPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('開発部')).toBeInTheDocument();
    expect(await screen.findByText('部長')).toBeInTheDocument();

    const section = screen.getByRole('region', { name: '所属' });
    await userEvent.type(within(section).getByLabelText('名称'), '人事部');
    await userEvent.click(within(section).getByRole('button', { name: '追加' }));
    expect(postDepartment).toHaveBeenCalledWith({ json: { name: '人事部' } });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/web test -- AdminMastersPage`
Expected: FAIL（`./AdminMastersPage` が存在しない）。

- [ ] **Step 3: ページを実装**

`apps/web/src/pages/AdminMastersPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useMasterMutations, useMasters, type MasterKind } from '../api/admin-masters';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

function MasterSection({ kind, title }: { kind: MasterKind; title: string }) {
  const { data: items } = useMasters(kind);
  const { create, update, remove } = useMasterMutations(kind);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await create.mutateAsync(name);
      setName('');
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  function onRename(id: string, current: string) {
    const next = prompt(`${title}の新しい名称`, current);
    if (next && next.trim() && next !== current) {
      update.mutate({ id, name: next.trim() }, { onError: (e) => setMessage(e.message) });
    }
  }

  // 隣と sortOrder を入れ替えて並び順を 1 つ動かす
  function onMove(index: number, dir: -1 | 1) {
    const list = items ?? [];
    const a = list[index];
    const b = list[index + dir];
    if (!a || !b) return;
    update.mutate({ id: a.id, sortOrder: b.sortOrder }, { onError: (e) => setMessage(e.message) });
    update.mutate({ id: b.id, sortOrder: a.sortOrder }, { onError: (e) => setMessage(e.message) });
  }

  function onDelete(id: string, itemName: string) {
    if (confirm(`「${itemName}」を削除しますか？\n割り当て済みのユーザーは「未設定」に戻ります。`)) {
      remove.mutate(id, { onError: (e) => setMessage(e.message) });
    }
  }

  const inputId = `master-name-${kind}`;
  return (
    <Card className="mb-6" role="region" aria-label={title}>
      <CardHeader>
        <h3 className="leading-none font-semibold">{title}</h3>
      </CardHeader>
      <CardContent>
        <form onSubmit={onCreate} className="mb-4 flex items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>名称</Label>
            <Input id={inputId} value={name} onChange={(e) => setName(e.target.value)} required className="w-56" />
          </div>
          <Button type="submit">追加</Button>
        </form>
        {message && <p role="alert" className="mb-2 text-sm text-destructive">{message}</p>}
        <ul className="divide-y">
          {(items ?? []).map((item, i) => (
            <li key={item.id} className="flex items-center gap-2 py-2">
              <span className="flex-1">{item.name}</span>
              <Button type="button" variant="ghost" size="sm" aria-label={`${item.name} を上へ`}
                disabled={i === 0} onClick={() => onMove(i, -1)}>↑</Button>
              <Button type="button" variant="ghost" size="sm" aria-label={`${item.name} を下へ`}
                disabled={i === (items ?? []).length - 1} onClick={() => onMove(i, 1)}>↓</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onRename(item.id, item.name)}>改名</Button>
              <Button type="button" variant="outline" size="sm"
                className="border-destructive text-destructive hover:text-destructive"
                onClick={() => onDelete(item.id, item.name)}>削除</Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function AdminMastersPage() {
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight">所属・役職マスタ</h2>
      <MasterSection kind="departments" title="所属" />
      <MasterSection kind="positions" title="役職" />
    </section>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/web test -- AdminMastersPage`
Expected: PASS。

- [ ] **Step 5: ルートとサイドバーを追加**

`apps/web/src/App.tsx`: import に `import { AdminMastersPage } from './pages/AdminMastersPage';` を追加し、`{ path: '/admin/categories', … }` の次に:

```tsx
      { path: '/admin/masters', element: <RequireRole role="admin"><AdminMastersPage /></RequireRole> },
```

`apps/web/src/components/Sidebar.tsx`: 管理グループの `<Item to="/admin" icon={Users} label="ユーザー" … />` の次の行に（`Briefcase` を lucide-react の import に追加）:

```tsx
            <Item to="/admin/masters" icon={Briefcase} label="所属・役職" onNavigate={onNavigate} />
```

- [ ] **Step 6: 型チェック + Commit**

Run: `pnpm --filter @knowledge-hub/web typecheck && pnpm --filter @knowledge-hub/web test`
Expected: PASS。

```bash
git add apps/web/src/pages/AdminMastersPage.tsx apps/web/src/pages/AdminMastersPage.test.tsx apps/web/src/App.tsx apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add org masters admin page"
```

---

### Task 13: AdminUsersPage 拡張（組織項目の個別編集 + CSV アップロード）

**Files:**
- Modify: `apps/web/src/pages/AdminUsersPage.tsx`
- Modify: `apps/web/src/pages/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: Task 10 の `useMasters`、Task 5 で拡張された `GET /api/admin/users` レスポンス（departmentId / positionId / hireYear）、Task 9 の import エンドポイント。
- Produces: ユーザー表に「所属」「役職」「入社年」列（select / select / number input、変更即 PATCH）。CSV アップロードカード（成功サマリ / 行番号付きエラー表示）。

- [ ] **Step 1: 失敗するテストを追記**

`apps/web/src/pages/AdminUsersPage.test.tsx` の mock を差し替え・拡張:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const patchUser = vi.fn().mockResolvedValue({ ok: true });
const postImport = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ updated: 2, createdDepartments: ['人事部'], createdPositions: [] }),
});
vi.mock('../api/client', () => ({
  api: {
    api: {
      admin: {
        users: {
          $get: vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [
              { id: '1', email: 'a@example.com', displayName: '管理者', role: 'admin', authProvider: 'password', isActive: true, createdAt: '2026-07-04T00:00:00Z', avatarUrl: null, departmentId: 'd1', positionId: null, hireYear: 2015 },
              { id: '2', email: 'b@example.com', displayName: '太郎', role: 'member', authProvider: 'password', isActive: false, createdAt: '2026-07-04T00:00:00Z', avatarUrl: null, departmentId: null, positionId: null, hireYear: null },
            ],
          }),
          invitations: { $post: vi.fn() },
          import: { $post: (...args: unknown[]) => postImport(...args) },
          ':id': { $patch: (...args: unknown[]) => patchUser(...args) },
        },
        departments: {
          $get: vi.fn().mockResolvedValue({
            ok: true, json: async () => [{ id: 'd1', name: '開発部', sortOrder: 0 }],
          }),
          $post: vi.fn(), ':id': { $patch: vi.fn(), $delete: vi.fn() },
        },
        positions: {
          $get: vi.fn().mockResolvedValue({
            ok: true, json: async () => [{ id: 'p1', name: '部長', sortOrder: 0 }],
          }),
          $post: vi.fn(), ':id': { $patch: vi.fn(), $delete: vi.fn() },
        },
      },
    },
  },
}));

import { AdminUsersPage } from './AdminUsersPage';

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminUsersPage />
    </QueryClientProvider>,
  );
}

describe('AdminUsersPage', () => {
  it('ユーザー一覧を表示し、無効ユーザーにはラベルが付く', async () => {
    renderPage();
    expect(await screen.findByText('a@example.com')).toBeInTheDocument();
    expect(await screen.findByText('無効')).toBeInTheDocument();

    const deactivateButton = await screen.findByRole('button', { name: '無効化' });
    expect(deactivateButton).toHaveClass('border-destructive', 'text-destructive');

    const activateButton = await screen.findByRole('button', { name: '有効化' });
    expect(activateButton).not.toHaveClass('border-destructive');
  });

  it('所属セレクトの変更で PATCH が飛ぶ（未選択は null）', async () => {
    renderPage();
    await screen.findByText('a@example.com');
    const select = screen.getByLabelText('管理者 の所属');
    expect(select).toHaveValue('d1');
    await userEvent.selectOptions(select, '');
    expect(patchUser).toHaveBeenCalledWith({ param: { id: '1' }, json: { departmentId: null } });
  });

  it('CSV アップロードの成功サマリを表示する', async () => {
    renderPage();
    await screen.findByText('a@example.com');
    const file = new File(['email,department,position,hire_year\n'], 'org.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('CSV ファイル'), file);
    await userEvent.click(screen.getByRole('button', { name: 'インポート' }));
    expect(await screen.findByText(/2 人を更新/)).toBeInTheDocument();
    expect(screen.getByText(/人事部/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/web test -- AdminUsersPage`
Expected: FAIL（所属セレクト・CSV UI が未実装）。

- [ ] **Step 3: 実装**

`apps/web/src/pages/AdminUsersPage.tsx` を変更する。

import 追加:

```tsx
import { useRef } from 'react';
import { useMasters } from '../api/admin-masters';
```

`AdminUsersPage` 関数内、既存の `useQuery` の後に追加:

```tsx
  const { data: departments } = useMasters('departments');
  const { data: positions } = useMasters('positions');
```

`patchUser` の mutationFn の input 型を拡張（既存の onSuccess / onError は変更しない）:

```tsx
  const patchUser = useMutation({
    mutationFn: async (input: {
      id: string;
      role?: 'member' | 'admin';
      isActive?: boolean;
      departmentId?: string | null;
      positionId?: string | null;
      hireYear?: number | null;
    }) => {
      const { id, ...json } = input;
      const res = await api.api.admin.users[':id'].$patch({ param: { id }, json });
      if (!res.ok) {
        throw new Error(await errorMessage(res, '更新に失敗しました'));
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.adminUsers }),
    onError: (e) => alert(e.message),
  });
```

CSV アップロード用の state とハンドラを追加:

```tsx
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<{ line: number; email?: string; message: string }[]>([]);

  async function onImport(e: FormEvent) {
    e.preventDefault();
    setImportMsg(null);
    setImportErrors([]);
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    try {
      const res = await api.api.admin.users.import.$post({ form: { file } });
      const body = await res.json();
      if (res.ok && 'updated' in body) {
        const created = [...(body.createdDepartments ?? []), ...(body.createdPositions ?? [])];
        setImportMsg(
          `${body.updated} 人を更新しました。` +
          (created.length > 0 ? `新規マスタ: ${created.join('、')}` : ''),
        );
        if (fileRef.current) fileRef.current.value = '';
        queryClient.invalidateQueries({ queryKey: keys.adminUsers });
        queryClient.invalidateQueries({ queryKey: keys.adminDepartments });
        queryClient.invalidateQueries({ queryKey: keys.adminPositions });
      } else if ('details' in body && Array.isArray(body.details)) {
        setImportMsg('message' in body ? String(body.message) : 'CSV にエラーがあります');
        setImportErrors(body.details as { line: number; email?: string; message: string }[]);
      } else {
        setImportMsg('message' in body ? String(body.message) : 'インポートに失敗しました');
      }
    } catch {
      setImportMsg(NETWORK_ERROR_MESSAGE);
    }
  }
```

招待カードの後（`</Card>` の直後）に CSV カードを追加:

```tsx
      <Card className="mb-6">
        <CardHeader>
          <h3 className="leading-none font-semibold">所属・役職・入社年を CSV で一括設定</h3>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            ヘッダー行 email,department,position,hire_year の UTF-8 CSV。空欄は未設定に戻ります。
            未知の所属・役職は自動登録。エラーが 1 行でもあると何も適用されません。
          </p>
          <form onSubmit={onImport} className="flex items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="import-file">CSV ファイル</Label>
              <Input id="import-file" type="file" accept=".csv,text/csv" ref={fileRef} required />
            </div>
            <Button type="submit">インポート</Button>
          </form>
          {importMsg && <p role="status" className="mt-3 text-sm text-muted-foreground">{importMsg}</p>}
          {importErrors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-destructive">
              {importErrors.map((e, i) => (
                <li key={i}>{e.line} 行目{e.email ? `（${e.email}）` : ''}: {e.message}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
```

テーブルヘッダーの「状態」の後に列を追加:

```tsx
            <TableHead>所属</TableHead>
            <TableHead>役職</TableHead>
            <TableHead>入社年</TableHead>
```

各行の「状態」セルの後にセルを追加（`selectClass` はコンポーネント冒頭で `const selectClass = 'h-8 rounded-md border border-input bg-transparent px-2 text-sm';` として定義）:

```tsx
              <TableCell>
                <select aria-label={`${u.displayName} の所属`} className={selectClass}
                  value={u.departmentId ?? ''}
                  onChange={(e) => patchUser.mutate({ id: u.id, departmentId: e.target.value || null })}>
                  <option value="">未設定</option>
                  {(departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </TableCell>
              <TableCell>
                <select aria-label={`${u.displayName} の役職`} className={selectClass}
                  value={u.positionId ?? ''}
                  onChange={(e) => patchUser.mutate({ id: u.id, positionId: e.target.value || null })}>
                  <option value="">未設定</option>
                  {(positions ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </TableCell>
              <TableCell>
                <Input
                  aria-label={`${u.displayName} の入社年`}
                  type="number" className="w-24" defaultValue={u.hireYear ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value);
                    if (v !== u.hireYear) patchUser.mutate({ id: u.id, hireYear: v });
                  }}
                />
              </TableCell>
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/web test -- AdminUsersPage`
Expected: PASS（3 テスト）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/AdminUsersPage.tsx apps/web/src/pages/AdminUsersPage.test.tsx
git commit -m "feat(web): edit user org fields and CSV import in admin users page"
```

---

### Task 14: ProfilePage に所属・役職・入社年を表示

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx:37-45`
- Modify: `apps/web/src/pages/ProfilePage.test.tsx`（mock のプロフィールに新項目を追加し、表示を検証）

**Interfaces:**
- Consumes: Task 5 で拡張された `GET /api/users/:id`（department / position / hireYear）。hc の型推論で自動で流れてくる。

- [ ] **Step 1: 失敗するテストを追記**

`apps/web/src/pages/ProfilePage.test.tsx` の既存 mock の `json` に `department: { id: 'd1', name: '開発部' }, position: { id: 'p1', name: '部長' }, hireYear: 2018` を追加し、テストを 1 本追加:

```tsx
  it('所属・役職・入社年を表示する', async () => {
    renderPage(); // 既存テストのレンダリングヘルパー / 手順に合わせる
    expect(await screen.findByText('開発部 / 部長 ・ 2018 年入社')).toBeInTheDocument();
  });
```

（既存テストのレンダリング方法・mock 構造に合わせて追記すること。mock に無いフィールドを追加しても既存アサーションは壊れない。）

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter @knowledge-hub/web test -- ProfilePage`
Expected: FAIL（表示が無い）。

- [ ] **Step 3: 実装**

`apps/web/src/pages/ProfilePage.tsx` の `<h2>` の直後（bio の前）に追加:

```tsx
          {(profile.department || profile.position || profile.hireYear !== null) && (
            <p className="text-sm text-muted-foreground">
              {[profile.department?.name, profile.position?.name].filter(Boolean).join(' / ')}
              {profile.hireYear !== null &&
                `${profile.department || profile.position ? ' ・ ' : ''}${profile.hireYear} 年入社`}
            </p>
          )}
```

- [ ] **Step 4: テストが通ることを確認 + Commit**

Run: `pnpm --filter @knowledge-hub/web test -- ProfilePage && pnpm --filter @knowledge-hub/web typecheck`
Expected: PASS。

```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): show org fields on user profile page"
```

---

### Task 15: ドキュメント追従（screens.md / api.md）

**Files:**
- Modify: `docs/screens.md`
- Modify: `docs/api.md`

**Interfaces:**
- Consumes: Task 4 / 6 / 9 のエンドポイント、Task 11 / 12 の画面。表の書式・権限記号（🔒 / 🛡️）は各ファイルの凡例に合わせる。

- [ ] **Step 1: screens.md を更新**

既存の表の書式に合わせて追記する:

- 画面一覧に `/members`（メンバー一覧、🔒 ログイン、「検索・所属 / 役職 / 入社年での絞り込み・並び替え、プロフィールへ遷移」）を追加し、キャプチャのプレースホルダー行 `./assets/screens/members.png` を足す。
- `/admin/masters`（所属・役職マスタ管理、🛡️ 管理者、「所属・役職の追加 / 改名 / 並び順 / 削除」）を追加し、`./assets/screens/admin-masters.png` を足す。
- 既存の `/admin`（ユーザー管理）の主な機能に「所属・役職・入社年の個別編集、CSV 一括設定」を追記。
- 既存の `/users/:id`（プロフィール）の主な機能に「所属・役職・入社年の表示」を追記。

- [ ] **Step 2: api.md を更新**

既存の表の書式に合わせて追記する:

- 「ユーザー `/api/users`」の近くに新セクション「プロフィール一覧 `/api/profiles`」: `GET /api/profiles`（🔒 ログイン、メンバー一覧 + 所属・役職マスタ）。
- 「管理 `/api/admin`」に以下を追加:
  - `GET/POST /api/admin/departments`、`PATCH/DELETE /api/admin/departments/:id`（🛡️ 管理者、所属マスタ CRUD）
  - `GET/POST /api/admin/positions`、`PATCH/DELETE /api/admin/positions/:id`（🛡️ 管理者、役職マスタ CRUD）
  - `POST /api/admin/users/import`（🛡️ 管理者、CSV で所属・役職・入社年を一括設定）
- `PATCH /api/admin/users/:id` の概要を「ユーザーのロール・状態・所属・役職・入社年を更新」に変更。
- `GET /api/users/:id` の概要に「所属・役職・入社年を含む」を追記。

- [ ] **Step 3: Commit**

```bash
git add docs/screens.md docs/api.md
git commit -m "docs: add member directory screens and APIs"
```

---

### Task 16: E2E シナリオと最終検証

**Files:**
- Create: `tests/e2e/specs/members.spec.ts`

**Interfaces:**
- Consumes: 全タスクの成果。既存 E2E と同じく管理者ログイン済みセッションで動く（`tests/e2e/setup` 参照）。

- [ ] **Step 1: E2E スペックを書く**

`tests/e2e/specs/members.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { unique } from '../helpers/data';

test('マスタ作成 → ユーザーへ割当 → メンバー一覧で絞り込み → プロフィール表示', async ({ page }) => {
  const department = unique('E2E開発部');
  const position = unique('E2E部長');

  // 1) admin がマスタを作成
  await page.goto('/admin/masters');
  const depSection = page.getByRole('region', { name: '所属' });
  await depSection.getByLabel('名称').fill(department);
  await depSection.getByRole('button', { name: '追加' }).click();
  await expect(depSection.getByText(department)).toBeVisible();

  const posSection = page.getByRole('region', { name: '役職' });
  await posSection.getByLabel('名称').fill(position);
  await posSection.getByRole('button', { name: '追加' }).click();
  await expect(posSection.getByText(position)).toBeVisible();

  // 2) ユーザー管理で自分（管理者）に割当
  await page.goto('/admin');
  const depSelect = page.locator('select[aria-label$="の所属"]').first();
  await depSelect.selectOption({ label: department });
  const posSelect = page.locator('select[aria-label$="の役職"]').first();
  await posSelect.selectOption({ label: position });
  const yearInput = page.locator('input[aria-label$="の入社年"]').first();
  await yearInput.fill('2019');
  await yearInput.blur();

  // 3) メンバー一覧: 所属で絞り込み
  await page.goto('/members');
  await page.getByLabel('所属').selectOption({ label: department });
  // サイドバーにも listitem があるため main 内に限定する
  const card = page.getByRole('main').getByRole('listitem').first();
  await expect(card).toContainText(department);
  await expect(card).toContainText('2019 年入社');

  // 4) カードからプロフィールへ
  await card.getByRole('link').click();
  await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}$/);
  await expect(page.getByText(new RegExp(`${department} / ${position}`))).toBeVisible();
});
```

- [ ] **Step 2: E2E を実行**

Run: `pnpm run e2e:up && pnpm run e2e -- members && pnpm run e2e:down`
Expected: PASS。セレクタずれで落ちた場合は実装ではなくスペック側の期待を実 UI に合わせて直す（aria-label は Task 12 / 13 で定義済み）。

- [ ] **Step 3: 検証ゲート**

Run: `pnpm run verify`
Expected: green（typecheck → test → contrast → web build → pnpm audit）。ProfilesPage / AdminMastersPage は既存の shadcn コンポーネントと `text-muted-foreground` 等の既存トーンのみ使用しているためコントラスト検査に新規色は増えない。

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/members.spec.ts
git commit -m "test(e2e): add member directory scenario"
```

---

## 完了条件

- `pnpm run verify` が green。
- `/members` で検索・所属 / 役職 / 入社年の絞り込み・4 種の並び替えが動く。
- 管理者が `/admin/masters` でマスタ管理、`/admin` で個別編集と CSV 一括設定ができる。本人（member）はこれらの項目を編集できない（`updateProfileSchema` 未変更のため経路が存在しない）。
- `docs/screens.md` / `docs/api.md` が実装と一致。
