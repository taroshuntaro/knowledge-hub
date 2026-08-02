# アカウントライフサイクル管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アカウントの入口を事前許可制（事前作成ユーザー + 登録コード / SSO クレーム）に統一し、CSV・UI での一括登録・一括無効化を実装する。

**Architecture:** `authProvider` enum に `'pending'` を追加して「事前作成・未ログイン」状態を表現。OIDC は JIT を廃止して pending 行のクレームに変更、パスワード側は `registration_codes`（ハッシュ保存・有効 1 つ）+ 公開 `/claim` ページ。個別メール招待フローは完全撤去。spec: `docs/superpowers/specs/2026-08-02-account-lifecycle-design.md`

**Tech Stack:** Hono + Drizzle + PostgreSQL（Testcontainers テスト）、Zod（packages/shared 契約）、React SPA、Playwright E2E。

## Global Constraints

- 検証ゲート: 各タスク完了時に対象パッケージのテスト green、最終タスクで `pnpm run verify` exit 0。
- マイグレーションは `apps/server/src/db/schema.ts` 変更 → `pnpm --filter @knowledge-hub/server db:generate`（**手書きしない**）。
- コミットは英語・Conventional Commits・1 コミット 1 論理変更。
- エラーは `AppError(code, message, status)`、コードは `packages/shared/src/errors.ts` の `ERROR_CODES` に追加。
- Web の UI 文言は日本語。エラー表示は `lib/api-error.ts` の `errorMessage` / `NETWORK_ERROR_MESSAGE`。
- 登録コード・パスワードなどの秘密情報はログ・DB に平文で残さない（ハッシュは `hashToken` = SHA-256）。
- クレーム失敗の応答は全態様で統一: `CLAIM_INVALID`「登録コードまたはメールアドレスが正しくありません」(400)。
- 「アクティブ管理者」= `role='admin' AND isActive AND authProvider != 'pending'`（全ガードで統一）。
- `docs/api.md` / `docs/screens.md` はルート / 画面を変えたタスク内で追従させる。

---

### Task 1: shared エラーコード・スキーマ追加

**Files:**
- Modify: `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/schemas/auth.ts`
- Modify: `packages/shared/src/index.ts`（barrel が明示 export の場合のみ追記）
- Test: `packages/shared/src/schemas/auth.test.ts`

**Interfaces:**
- Produces: `ERROR_CODES` に `'CLAIM_INVALID' | 'OIDC_NOT_PROVISIONED'` 追加。
  `claimSchema = z.object({ email, code, password })`、
  `issueRegistrationCodeSchema = z.object({ expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90)]) })`、
  `adminCreateUserSchema = z.object({ email, displayName, departmentId?, positionId?, hireYear? })`、
  `deactivateUsersSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(1000) })`

- [ ] **Step 1: 失敗するテストを書く**（`auth.test.ts` に追記）

```ts
import { adminCreateUserSchema, claimSchema, deactivateUsersSchema, issueRegistrationCodeSchema } from './auth';

describe('account lifecycle schemas', () => {
  it('claimSchema は email+code+password(12+) を受理する', () => {
    expect(claimSchema.safeParse({ email: 'a@example.com', code: 'ABCD-EFGH-JKMN-PQRS', password: 'a'.repeat(12) }).success).toBe(true);
  });
  it('claimSchema は 11 文字パスワードを拒否する', () => {
    expect(claimSchema.safeParse({ email: 'a@example.com', code: 'X', password: 'a'.repeat(11) }).success).toBe(false);
  });
  it('issueRegistrationCodeSchema は 7/30/90 のみ受理する', () => {
    expect(issueRegistrationCodeSchema.safeParse({ expiresInDays: 30 }).success).toBe(true);
    expect(issueRegistrationCodeSchema.safeParse({ expiresInDays: 14 }).success).toBe(false);
  });
  it('adminCreateUserSchema は email+displayName 必須', () => {
    expect(adminCreateUserSchema.safeParse({ email: 'a@example.com', displayName: '太郎' }).success).toBe(true);
    expect(adminCreateUserSchema.safeParse({ email: 'a@example.com' }).success).toBe(false);
  });
  it('deactivateUsersSchema は空配列を拒否する', () => {
    expect(deactivateUsersSchema.safeParse({ userIds: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: `pnpm --filter @knowledge-hub/shared test` で FAIL を確認**（export が無い）

- [ ] **Step 3: 実装**

`errors.ts` の配列末尾に `'CLAIM_INVALID', 'OIDC_NOT_PROVISIONED',` を追加。`schemas/auth.ts` に追記:

```ts
export const claimSchema = z.object({
  email: z.string().email(),
  code: z.string().min(1).max(40),
  password: passwordSchema,
});
export const issueRegistrationCodeSchema = z.object({
  expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});
export const adminCreateUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(50),
  departmentId: z.string().uuid().nullable().optional(),
  positionId: z.string().uuid().nullable().optional(),
  hireYear: hireYearSchema.nullable().optional(),
});
export const deactivateUsersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(1000),
});
```

- [ ] **Step 4: `pnpm --filter @knowledge-hub/shared test` PASS + `pnpm -r typecheck`**
- [ ] **Step 5: Commit** `feat: add claim and provisioning schemas to shared contract`

---

### Task 2: DB スキーマ（enum 'pending' + registration_codes）

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/services/session-service.ts`（`toSessionUser` の pending ガード）
- Create: `apps/server/drizzle/0008_*.sql`（`db:generate` で生成）
- Test: `apps/server/src/services/session-service.test.ts`（既存に追記）

**Interfaces:**
- Produces: `authProviderEnum = pgEnum('auth_provider', ['oidc', 'password', 'pending'])`、
  `registrationCodes` テーブル（`id uuid PK / codeHash text notNull unique / expiresAt tz notNull / revokedAt tz null / createdAt tz notNull defaultNow`）。
  `toSessionUser` は `authProvider==='pending'` の行を渡すと throw（型は `SessionUser` のまま）。
- 注意: `invitations` テーブルはここでは**削除しない**（Task 3 でサービスごと撤去）。

- [ ] **Step 1: schema.ts を変更**

```ts
export const authProviderEnum = pgEnum('auth_provider', ['oidc', 'password', 'pending']);

export const registrationCodes = pgTable('registration_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  codeHash: text('code_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: `toSessionUser` に pending ガードを追加**（enum 拡張で `SessionUser.authProvider` への代入が型エラーになるため同一タスクで対応）

```ts
export function toSessionUser(user: typeof users.$inferSelect): SessionUser {
  if (user.authProvider === 'pending') {
    // pending はあらゆるログイン経路で拒否されるため到達しない（防御的ガード + 型の絞り込み）
    throw new Error('pending user cannot have a session');
  }
  return { id: user.id, email: user.email, displayName: user.displayName,
    role: user.role, avatarUrl: user.avatarUrl, bio: user.bio, authProvider: user.authProvider };
}
```

- [ ] **Step 3: `pnpm --filter @knowledge-hub/server db:generate` でマイグレーション生成**。生成 SQL に `ALTER TYPE "auth_provider" ADD VALUE 'pending'` と `CREATE TABLE "registration_codes"` が含まれることを確認（新値は同一マイグレーション内で未使用なのでトランザクション制約に抵触しない）。
- [ ] **Step 4: `pnpm --filter @knowledge-hub/server test` PASS**（Testcontainers が起動時に新マイグレーションを適用。既存テストが green ならスキーマ互換）+ `pnpm -r typecheck`
- [ ] **Step 5: Commit** `feat: add pending auth provider and registration_codes table`

---

### Task 3: 招待フローの完全撤去（server + web + shared）

**Files:**
- Delete: `apps/server/src/services/invitation-service.ts`, `invitation-service.test.ts`
- Modify: `apps/server/src/routes/auth.ts`（`/invitations/:token/accept` 削除）
- Modify: `apps/server/src/routes/admin.ts`（`POST /users/invitations` 削除）
- Modify: `apps/server/src/db/schema.ts`（`invitations` テーブル削除）+ `db:generate`（0009: DROP TABLE）
- Delete: `apps/web/src/pages/InvitePage.tsx`
- Modify: `apps/web/src/App.tsx`（`/invite/:token` ルート削除）、`apps/web/src/pages/AdminUsersPage.tsx`（招待フォーム削除）
- Modify: `packages/shared/src/schemas/auth.ts`（`inviteSchema` / `acceptInvitationSchema` 削除。`acceptInvitationSchema` 参照テストも削除）
- Modify: `docs/api.md`（招待 2 エンドポイント行削除）、`docs/screens.md`（/invite 行削除）

**Interfaces:**
- Consumes: なし（削除のみ）
- Produces: 招待系のシンボル・ルート・テーブルが存在しない状態。E2E setup の破損は Task 12 で解消（それまで E2E は実行しない）。

- [ ] **Step 1: server から削除**（routes/auth.ts の import と `.post('/invitations/:token/accept', ...)` ブロック、admin.ts の `inviteSchema` import と `.post('/users/invitations', ...)` ブロック、invitation-service 本体とテスト）
- [ ] **Step 2: schema.ts から `invitations` テーブル定義を削除し `db:generate`**（DROP TABLE マイグレーション生成を確認）
- [ ] **Step 3: web から削除**（InvitePage.tsx、App.tsx の import + ルート行、AdminUsersPage.tsx の招待メール入力・「招待を送る」ボタンと `api.api.admin.users.invitations.$post` 呼び出し・関連 state。AdminUsersPage の既存テストから招待関連の記述を削除）
- [ ] **Step 4: shared から `inviteSchema` / `acceptInvitationSchema` を削除**し、参照テストを削除
- [ ] **Step 5: `pnpm -r typecheck && pnpm test` PASS**（残存参照はここで炙り出す）。docs/api.md・screens.md を追従。
- [ ] **Step 6: Commit** `feat!: remove email invitation flow`

---

### Task 4: registration-code-service

**Files:**
- Create: `apps/server/src/services/registration-code-service.ts`
- Test: `apps/server/src/services/registration-code-service.test.ts`

**Interfaces:**
- Consumes: `hashToken`（session-service）、`registrationCodes`（schema）
- Produces:
  - `issueRegistrationCode(db: Db, expiresInDays: number): Promise<{ code: string; expiresAt: Date }>`
  - `revokeActiveCode(db: Db): Promise<void>`
  - `getActiveCodeMeta(db: Db): Promise<{ createdAt: Date; expiresAt: Date } | null>`
  - `verifyRegistrationCode(db: Db, code: string): Promise<boolean>`

- [ ] **Step 1: 失敗するテストを書く**（既存サービステストの Testcontainers セットアップの流儀に合わせる）

```ts
describe('registration-code-service', () => {
  it('発行したコードは verify に通り、メタデータが取得できる', async () => {
    const { code, expiresAt } = await issueRegistrationCode(db, 30);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await verifyRegistrationCode(db, code)).toBe(true);
    const meta = await getActiveCodeMeta(db);
    expect(meta?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });
  it('新規発行で旧コードは失効する（有効は常に 1 つ）', async () => {
    const first = await issueRegistrationCode(db, 30);
    const second = await issueRegistrationCode(db, 30);
    expect(await verifyRegistrationCode(db, first.code)).toBe(false);
    expect(await verifyRegistrationCode(db, second.code)).toBe(true);
  });
  it('revoke 後は verify も meta も無効', async () => {
    await issueRegistrationCode(db, 30);
    await revokeActiveCode(db);
    expect(await getActiveCodeMeta(db)).toBeNull();
  });
  it('期限切れコードは verify に通らない', async () => {
    const { code } = await issueRegistrationCode(db, 30);
    await db.update(registrationCodes).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await verifyRegistrationCode(db, code)).toBe(false);
  });
  it('不一致コードは false', async () => {
    await issueRegistrationCode(db, 30);
    expect(await verifyRegistrationCode(db, 'AAAA-AAAA-AAAA-AAAA')).toBe(false);
  });
});
```

- [ ] **Step 2: 実行して FAIL 確認**
- [ ] **Step 3: 実装**

```ts
import { randomBytes } from 'node:crypto';
import { and, gt, isNull } from 'drizzle-orm';
import { registrationCodes } from '../db/schema';
import type { Db } from '../types';
import { hashToken } from './session-service';

// 紛らわしい文字（I/L/O/0/1）を除いた 31 文字。16 文字 ≈ 79bit で総当たり不能。
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const chars = Array.from(randomBytes(16), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

const activeWhere = () =>
  and(isNull(registrationCodes.revokedAt), gt(registrationCodes.expiresAt, new Date()));

export async function issueRegistrationCode(db: Db, expiresInDays: number) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  await db.transaction(async (tx) => {
    await tx.update(registrationCodes).set({ revokedAt: new Date() }).where(isNull(registrationCodes.revokedAt));
    await tx.insert(registrationCodes).values({ codeHash: hashToken(code), expiresAt });
  });
  return { code, expiresAt };
}

export async function revokeActiveCode(db: Db): Promise<void> {
  await db.update(registrationCodes).set({ revokedAt: new Date() }).where(isNull(registrationCodes.revokedAt));
}

export async function getActiveCodeMeta(db: Db) {
  const [row] = await db
    .select({ createdAt: registrationCodes.createdAt, expiresAt: registrationCodes.expiresAt })
    .from(registrationCodes).where(activeWhere()).limit(1);
  return row ?? null;
}

export async function verifyRegistrationCode(db: Db, code: string): Promise<boolean> {
  const [row] = await db
    .select({ id: registrationCodes.id })
    .from(registrationCodes)
    .where(and(eq(registrationCodes.codeHash, hashToken(code)), activeWhere()))
    .limit(1);
  return row !== undefined;
}
```

- [ ] **Step 4: テスト PASS 確認**
- [ ] **Step 5: Commit** `feat: add registration code service`

---

### Task 5: クレームサービス（パスワード側）

**Files:**
- Create: `apps/server/src/services/claim-service.ts`
- Test: `apps/server/src/services/claim-service.test.ts`

**Interfaces:**
- Consumes: `verifyRegistrationCode`（Task 4）、`hashPassword`（password.ts）、`createSession` / `toSessionUser`（session-service）、`normalizeEmail`（email.ts）
- Produces: `claimAccount(db: Db, input: { email: string; code: string; password: string }): Promise<{ sid: string; user: SessionUser } | null>`（null = 全失敗態様。呼び出し側が `CLAIM_INVALID` に変換）

- [ ] **Step 1: 失敗するテストを書く**

```ts
async function seedPending(email: string) {
  const [u] = await db.insert(users)
    .values({ email, displayName: '未ログイン', authProvider: 'pending', passwordHash: null })
    .returning();
  return u;
}

describe('claimAccount', () => {
  it('有効コード + pending 行で成功しセッションを返す', async () => {
    const { code } = await issueRegistrationCode(db, 30);
    await seedPending('new@example.com');
    const result = await claimAccount(db, { email: 'New@Example.com', code, password: 'p'.repeat(12) });
    expect(result?.user.authProvider).toBe('password');
    const [row] = await db.select().from(users).where(eq(users.email, 'new@example.com'));
    expect(row.authProvider).toBe('password');
    expect(row.passwordHash).not.toBeNull();
  });
  it.each([
    ['コード不一致', async () => { await issueRegistrationCode(db, 30); await seedPending('a@example.com'); return { email: 'a@example.com', code: 'AAAA-AAAA-AAAA-AAAA' }; }],
    ['行なし', async () => { const { code } = await issueRegistrationCode(db, 30); return { email: 'none@example.com', code }; }],
    ['クレーム済み', async () => { const { code } = await issueRegistrationCode(db, 30); await seedPending('b@example.com'); await claimAccount(db, { email: 'b@example.com', code, password: 'p'.repeat(12) }); return { email: 'b@example.com', code }; }],
    ['無効化済み pending', async () => { const { code } = await issueRegistrationCode(db, 30); const u = await seedPending('c@example.com'); await db.update(users).set({ isActive: false }).where(eq(users.id, u.id)); return { email: 'c@example.com', code }; }],
  ])('%s は null（統一失敗）', async (_label, arrange) => {
    const input = await arrange();
    expect(await claimAccount(db, { ...input, password: 'p'.repeat(12) })).toBeNull();
  });
  it('並行二重クレームは片方だけ成功する', async () => {
    const { code } = await issueRegistrationCode(db, 30);
    await seedPending('race@example.com');
    const results = await Promise.all([
      claimAccount(db, { email: 'race@example.com', code, password: 'p'.repeat(12) }),
      claimAccount(db, { email: 'race@example.com', code, password: 'q'.repeat(12) }),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 実行して FAIL 確認**
- [ ] **Step 3: 実装**

```ts
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
  if (!(await verifyRegistrationCode(db, input.code))) return null;
  const passwordHash = await hashPassword(input.password);
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
```

- [ ] **Step 4: テスト PASS 確認**
- [ ] **Step 5: Commit** `feat: add registration-code claim service`

---

### Task 6: OIDC の JIT 廃止と pending クレーム

**Files:**
- Modify: `apps/server/src/services/oidc-service.ts`（`upsertByEmail` のみ）
- Test: `apps/server/src/services/oidc-service.test.ts`（既存に追記・修正）

**Interfaces:**
- Consumes: `users`（authProvider 'pending' を含む）
- Produces: `resolveOidcUser` のシグネチャ不変。挙動変更: pending 行 → `authProvider='oidc'` に確定して返す／行なし → `AppError('OIDC_NOT_PROVISIONED', 'このメールアドレスは登録されていません。管理者にお問い合わせください', 403)`。password 自動リンク（email_verified 必須）と oidc 再ログインは不変。

- [ ] **Step 1: 失敗するテストを書く**（既存の JIT 成功テストは「行なし → 拒否」に書き換え）

```ts
it('pending 行は初回 SSO でクレームされ oidc に確定する', async () => {
  await db.insert(users).values({ email: 'pre@example.com', displayName: '事前 太郎', authProvider: 'pending', passwordHash: null });
  const user = await resolveOidcUser(db, { email: 'pre@example.com', emailVerified: true, name: 'IdP Name' }, []);
  expect(user.authProvider).toBe('oidc');
  expect(user.displayName).toBe('事前 太郎'); // 事前作成時の表示名を維持
});
it('行がない email は OIDC_NOT_PROVISIONED で拒否される（JIT 廃止）', async () => {
  await expect(resolveOidcUser(db, { email: 'stranger@example.com', emailVerified: true }, []))
    .rejects.toMatchObject({ code: 'OIDC_NOT_PROVISIONED' });
});
// 既存の回帰: password 自動リンク（verified のみ）/ OIDC_LINK_UNVERIFIED / OIDC_INACTIVE /
// oidc 再ログイン / ドメイン制限 のテストは変更せず green を維持する
```

- [ ] **Step 2: 実行して FAIL 確認**
- [ ] **Step 3: `upsertByEmail` を変更**（insert 分岐を削除し pending 分岐を追加）

```ts
async function upsertByEmail(db: Db, email: string, _displayName: string, emailVerified: boolean) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users)
      .where(sql`lower(${users.email}) = ${email}`).limit(1).for('update');
    // JIT 廃止: 事前作成された行がなければログインさせない（事前許可制）
    if (!existing) {
      throw new AppError('OIDC_NOT_PROVISIONED', 'このメールアドレスは登録されていません。管理者にお問い合わせください', 403);
    }
    if (!existing.isActive) throw new AppError('OIDC_INACTIVE', 'このアカウントは無効化されています', 403);
    if (existing.authProvider === 'pending') {
      const [claimed] = await tx.update(users)
        .set({ authProvider: 'oidc', passwordHash: null })
        .where(eq(users.id, existing.id)).returning();
      return claimed;
    }
    if (existing.authProvider === 'password') {
      /* 既存の email_verified ガード + 自動リンク処理をそのまま維持 */
    }
    return existing;
  });
}
```

`resolveOidcUser` の `isUniqueViolation` リトライは insert が消えるため不要になる → catch ごと削除し、`upsertByEmail` を直接 return する。`displayName` 引数も未使用になるため削除（呼び出し側の `claims.name` 導出も削除）。

- [ ] **Step 4: テスト PASS + 既存回帰 green 確認**
- [ ] **Step 5: Commit** `feat!: replace OIDC JIT provisioning with pending-row claim`

---

### Task 7: 事前作成サービス（個別 + 登録 CSV）

**Files:**
- Create: `apps/server/src/services/user-provision-service.ts`
- Modify: `apps/server/src/services/user-import-service.ts`（`ensureDepartments` / `ensurePositions` を `export` に変更するのみ）
- Test: `apps/server/src/services/user-provision-service.test.ts`

**Interfaces:**
- Consumes: `parseCsv`（csv.ts）、`normalizeEmail`、`ensureDepartments` / `ensurePositions` / `ImportError`（user-import-service）、`HIRE_YEAR_MIN` / `hireYearMax`（shared）、`AdminUserView` / `toAdminView` 相当（user-service の `listUsers` と同形）
- Produces:
  - `createPendingUser(db: Db, input: { email: string; displayName: string; departmentId?: string | null; positionId?: string | null; hireYear?: number | null }): Promise<AdminUserView>`（既存 email → `AppError('EMAIL_TAKEN', 'このメールアドレスは既に登録されています', 409)`、不在 departmentId/positionId → `AppError('VALIDATION', ..., 400)`）
  - `importUserRegistrations(db: Db, csvText: string): Promise<{ ok: true; created: number; createdDepartments: string[]; createdPositions: string[] } | { ok: false; errors: ImportError[] }>`
  - CSV ヘッダー: `email,display_name,department,position,hire_year`（email / display_name 必須）

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe('createPendingUser', () => {
  it('pending 行を member 固定で作成する', async () => {
    const view = await createPendingUser(db, { email: 'New@Example.com', displayName: '新井' });
    expect(view).toMatchObject({ email: 'new@example.com', role: 'member', authProvider: 'pending', isActive: true });
  });
  it('既存 email は EMAIL_TAKEN', async () => {
    await createPendingUser(db, { email: 'dup@example.com', displayName: 'A' });
    await expect(createPendingUser(db, { email: 'dup@example.com', displayName: 'B' }))
      .rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });
});

describe('importUserRegistrations', () => {
  const header = 'email,display_name,department,position,hire_year';
  it('all-or-nothing: 1 行でもエラーなら何も作らない', async () => {
    const result = await importUserRegistrations(db, `${header}\na@example.com,佐藤,,,\n,名無し,,,`);
    expect(result.ok).toBe(false);
    expect(await db.$count(users)).toBe(0);
  });
  it('正常 CSV は pending 行を作成しマスタを自動登録する', async () => {
    const result = await importUserRegistrations(db, `${header}\na@example.com,佐藤,開発部,主任,2026\nb@example.com,鈴木,,,`);
    expect(result).toMatchObject({ ok: true, created: 2, createdDepartments: ['開発部'], createdPositions: ['主任'] });
    const [a] = await db.select().from(users).where(eq(users.email, 'a@example.com'));
    expect(a.authProvider).toBe('pending');
    expect(a.hireYear).toBe(2026);
  });
  it('既存 email は行エラー', async () => {
    await createPendingUser(db, { email: 'dup@example.com', displayName: 'A' });
    const result = await importUserRegistrations(db, `${header}\ndup@example.com,重複,,,`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ line: 2, email: 'dup@example.com' });
  });
  it('display_name 空は行エラー / 重複 email 行は行エラー / ヘッダー不正はエラー', async () => {
    expect((await importUserRegistrations(db, `${header}\na@example.com,,,,`)).ok).toBe(false);
    expect((await importUserRegistrations(db, `${header}\na@example.com,x,,,\na@example.com,y,,,`)).ok).toBe(false);
    expect((await importUserRegistrations(db, 'email\na@example.com')).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 実行して FAIL 確認**
- [ ] **Step 3: 実装**（`importUserOrg` の構造を踏襲: パース → 行検証 → 単一トランザクションで存在チェック + `ensureDepartments/Positions` + insert）

```ts
const HEADER = ['email', 'display_name', 'department', 'position', 'hire_year'];

export async function importUserRegistrations(db: Db, csvText: string): Promise<RegistrationImportResult> {
  // パース・ヘッダー検証・行検証（email 必須/正規化/重複、display_name 必須、hire_year は
  // importUserOrg と同じ範囲検証）を行い ParsedRow[] を作る（importUserOrg と同構造）。
  return db.transaction(async (tx) => {
    const existing = await tx.select({ email: users.email }).from(users)
      .where(inArray(users.email, rows.map((r) => r.email)));
    for (const e of existing) {
      const row = rows.find((r) => r.email === e.email)!;
      errors.push({ line: row.line, email: e.email, message: 'このメールアドレスは既に登録されています' });
    }
    if (errors.length > 0) return { ok: false as const, errors: errors.sort((a, b) => a.line - b.line) };
    const createdDepartments = await ensureDepartments(tx, [...new Set(rows.map((r) => r.department).filter((n) => n !== ''))]);
    const createdPositions = await ensurePositions(tx, [...new Set(rows.map((r) => r.position).filter((n) => n !== ''))]);
    // depIdByName / posIdByName を引き直し（importUserOrg と同じ）、まとめて insert:
    await tx.insert(users).values(rows.map((r) => ({
      email: r.email, displayName: r.displayName, authProvider: 'pending' as const, passwordHash: null,
      departmentId: r.department === '' ? null : depIdByName.get(r.department)!,
      positionId: r.position === '' ? null : posIdByName.get(r.position)!,
      hireYear: r.hireYear,
    })));
    return { ok: true as const, created: rows.length, createdDepartments, createdPositions };
  });
}

export async function createPendingUser(db: Db, input: ProvisionInput): Promise<AdminUserView> {
  const email = normalizeEmail(input.email);
  // departmentId/positionId の実在チェック（updateUserByAdmin と同じ VALIDATION 400）
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) throw new AppError('EMAIL_TAKEN', 'このメールアドレスは既に登録されています', 409);
  const [row] = await db.insert(users).values({
    email, displayName: input.displayName, authProvider: 'pending', passwordHash: null,
    departmentId: input.departmentId ?? null, positionId: input.positionId ?? null, hireYear: input.hireYear ?? null,
  }).returning();
  return toAdminView(row);
}
```

`toAdminView` は user-service にあり module-private → `export` に変更して import する。

- [ ] **Step 4: テスト PASS 確認**
- [ ] **Step 5: Commit** `feat: add pending user provisioning (single + CSV)`

---

### Task 8: 一括無効化 + アクティブ管理者定義の統一

**Files:**
- Modify: `apps/server/src/services/user-service.ts`（`loginableAdminWhere` 追加・`updateUserByAdmin` ガード更新・`deactivateUsers` 追加）
- Create: `apps/server/src/services/user-deactivation-import.ts`
- Test: `apps/server/src/services/user-service.test.ts`（追記）、`apps/server/src/services/user-deactivation-import.test.ts`

**Interfaces:**
- Produces:
  - `loginableAdminWhere = and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.authProvider, 'pending'))`（user-service 内で共有）
  - `deactivateUsers(db: Db, userIds: string[]): Promise<{ deactivated: number }>`（不在 id → `NOT_FOUND` 404 全体失敗／既に無効は no-op で数えない／実行後にログイン可能な管理者 0 → `LAST_ADMIN` 409／成功時は対象全員のセッション削除）
  - `importUserDeactivations(db: Db, csvText: string): Promise<{ ok: true; deactivated: number } | { ok: false; errors: ImportError[] }>`（ヘッダー `email` のみ・不在 email は行エラー）

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe('deactivateUsers', () => {
  it('複数ユーザーを無効化しセッションを失効させる', async () => {
    const a = await seedUser({ email: 'a@example.com' }); // authProvider 'password' の helper
    const b = await seedUser({ email: 'b@example.com' });
    const sid = await createSession(db, a.id);
    const result = await deactivateUsers(db, [a.id, b.id]);
    expect(result.deactivated).toBe(2);
    expect(await getSessionUser(db, sid)).toBeNull();
  });
  it('既に無効なユーザーは no-op（冪等）', async () => {
    const a = await seedUser({ email: 'a@example.com', isActive: false });
    expect((await deactivateUsers(db, [a.id])).deactivated).toBe(0);
  });
  it('バッチでログイン可能な管理者が 0 になるなら LAST_ADMIN', async () => {
    const admin1 = await seedUser({ email: 'a1@example.com', role: 'admin' });
    const admin2 = await seedUser({ email: 'a2@example.com', role: 'admin' });
    await expect(deactivateUsers(db, [admin1.id, admin2.id])).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });
  it('pending の管理者はアクティブ管理者に数えない', async () => {
    const real = await seedUser({ email: 'real@example.com', role: 'admin' });
    await db.insert(users).values({ email: 'pend@example.com', displayName: 'P', role: 'admin', authProvider: 'pending' });
    await expect(deactivateUsers(db, [real.id])).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });
  it('不在 id は NOT_FOUND で全体失敗', async () => {
    const a = await seedUser({ email: 'a@example.com' });
    await expect(deactivateUsers(db, [a.id, '00000000-0000-0000-0000-000000000000']))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db.select().from(users).where(eq(users.id, a.id));
    expect(row.isActive).toBe(true);
  });
});
// updateUserByAdmin の既存 LAST_ADMIN テストに「pending admin は数えない」ケースを追加
// importUserDeactivations: ヘッダー検証 / 不在 email 行エラー(all-or-nothing) / 正常系 / 無効済み no-op
```

- [ ] **Step 2: 実行して FAIL 確認**
- [ ] **Step 3: 実装**

```ts
const loginableAdminWhere = () =>
  and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.authProvider, 'pending'));

export async function deactivateUsers(db: Db, userIds: string[]): Promise<{ deactivated: number }> {
  const ids = [...new Set(userIds)];
  const targets = await db.transaction(async (tx) => {
    const found = await tx.select().from(users).where(inArray(users.id, ids)).for('update');
    if (found.length !== ids.length) throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);
    const admins = await tx.select({ id: users.id }).from(users).where(loginableAdminWhere()).for('update');
    const targetSet = new Set(ids);
    const remaining = admins.filter((a) => !targetSet.has(a.id)).length;
    if (remaining === 0) throw new AppError('LAST_ADMIN', '最後の管理者は無効化できません', 409);
    const toDeactivate = found.filter((u) => u.isActive).map((u) => u.id);
    if (toDeactivate.length > 0) {
      await tx.update(users).set({ isActive: false }).where(inArray(users.id, toDeactivate));
    }
    return toDeactivate;
  });
  await Promise.all(targets.map((id) => deleteUserSessions(db, id)));
  return { deactivated: targets.length };
}
```

`updateUserByAdmin` の `activeAdmins` クエリを `loginableAdminWhere()` に置換。
`user-deactivation-import.ts` は `parseCsv` → ヘッダー `['email']` 検証 → email 正規化・重複/空チェック → email→id 解決（不在は行エラー、all-or-nothing）→ `deactivateUsers` を呼ぶ。

- [ ] **Step 4: テスト PASS 確認**
- [ ] **Step 5: Commit** `feat: add bulk deactivation with unified loginable-admin guard`

---

### Task 9: pending の可視性制御と管理操作（delete / unclaim）

**Files:**
- Modify: `apps/server/src/services/user-service.ts`（`listMentionCandidates` / `getPublicProfile` / `deletePendingUser` / `unclaimUser`）
- Modify: `apps/server/src/services/profile-service.ts`（`listProfiles` の where）
- Test: `apps/server/src/services/user-service.test.ts`、`apps/server/src/services/profile-service.test.ts`（追記）

**Interfaces:**
- Produces:
  - `listMentionCandidates` / `listProfiles`: `ne(users.authProvider, 'pending')` を where に追加
  - `getPublicProfile`: pending 行は `NOT_FOUND` 404
  - `deletePendingUser(db: Db, id: string): Promise<void>`（不在 → 404／`authProvider !== 'pending'` → `AppError('CONFLICT', 'ログイン済みユーザーは削除できません。無効化を使ってください', 409)`／pending ならハード削除）
  - `unclaimUser(db: Db, id: string): Promise<AdminUserView>`（不在 → 404／pending → `CONFLICT` 409／最後のログイン可能管理者 → `LAST_ADMIN` 409／成功: `authProvider='pending'`, `passwordHash=null`, セッション全削除）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('pending はメンション候補・名簿に出ず、プロフィールは 404', async () => {
  await db.insert(users).values({ email: 'p@example.com', displayName: 'P', authProvider: 'pending' });
  expect((await listMentionCandidates(db)).map((u) => u.displayName)).not.toContain('P');
  expect((await listProfiles(db)).users.map((u) => u.displayName)).not.toContain('P');
  const [p] = await db.select().from(users).where(eq(users.email, 'p@example.com'));
  await expect(getPublicProfile(db, p.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('deletePendingUser は pending のみ削除でき、クレーム済みは 409', async () => { /* 上記 Interfaces のとおり */ });
it('unclaimUser はクレーム済みを pending に戻しセッションを失効させる', async () => {
  const u = await seedUser({ email: 'u@example.com' });
  const sid = await createSession(db, u.id);
  const view = await unclaimUser(db, u.id);
  expect(view.authProvider).toBe('pending');
  expect(await getSessionUser(db, sid)).toBeNull();
});
it('unclaimUser: pending 対象は 409 / 最後のログイン可能管理者は LAST_ADMIN', async () => { /* 2 ケース */ });
```

- [ ] **Step 2: 実行して FAIL 確認**
- [ ] **Step 3: 実装**（`unclaimUser` は `updateUserByAdmin` と同じ tx + `loginableAdminWhere()` FOR UPDATE パターン。`deletePendingUser` は `delete ... where and(eq(users.id, id), eq(users.authProvider, 'pending'))` の 0 行判定で 404/409 を出し分け: 先に存在確認 → pending 判定）
- [ ] **Step 4: テスト PASS 確認**
- [ ] **Step 5: Commit** `feat: hide pending users and add unclaim/delete admin operations`

---

### Task 10: ルート配線（auth claim + admin 一式）+ docs/api.md

**Files:**
- Modify: `apps/server/src/routes/auth.ts`（`POST /claim` + `claimLimiter`）
- Modify: `apps/server/src/routes/admin.ts`（registration-code 3 本・users 作成/インポート/無効化/削除/unclaim）
- Modify: `docs/api.md`
- Test: `apps/server/src/routes/auth.test.ts`、`apps/server/src/routes/admin.test.ts`（追記）

**Interfaces:**
- Consumes: Task 1 のスキーマ、Task 4/5/7/8/9 のサービス関数（シグネチャは各 Interfaces のとおり）
- Produces（spec §10 の表と一致）:
  - `POST /api/auth/claim`（`requirePasswordAuth` + `claimLimiter`(10 回/15 分, email キー) → 成功でセッション cookie + `SessionUser`、失敗 `CLAIM_INVALID` 400）
  - `GET/POST/DELETE /api/admin/registration-code`
  - `POST /api/admin/users`（201）、`POST /api/admin/users/registrations/import`、`POST /api/admin/users/deactivate`、`POST /api/admin/users/deactivate/import`、`DELETE /api/admin/users/:id`、`POST /api/admin/users/:id/unclaim`
  - **注意**: Hono は登録順マッチのため、`/users/registrations/import`・`/users/deactivate`・`/users/deactivate/import` は `/users/:id` 系（patch/delete/unclaim）より**先に**登録する。

- [ ] **Step 1: 失敗するルートテストを書く**（既存 route テストの流儀 = buildApp + 実 DB。代表ケース）

```ts
it('POST /api/auth/claim は成功でセッション cookie を返す', async () => { /* pending seed + code 発行 → 200 + set-cookie */ });
it('POST /api/auth/claim は失敗を CLAIM_INVALID 400 で返す', async () => { /* garbage code → { code: 'CLAIM_INVALID' } */ });
it('PASSWORD_AUTH_ENABLED=false では /claim が 403', async () => { /* passwordAuthEnabled: false の config で buildApp */ });
it('registration-code は admin のみ（member は 403）/ POST が平文 code を 1 回だけ返す', async () => { ... });
it('POST /api/admin/users は 201 で AdminUserView を返す', async () => { ... });
it('POST /api/admin/users/deactivate は userIds を無効化する', async () => { ... });
it('CSV 2 種は CSV_IMPORT_FAILED で行エラーを返す', async () => { /* 既存 /users/import テストの形を踏襲 */ });
it('DELETE /api/admin/users/:id は pending のみ / unclaim は claimed のみ', async () => { ... });
```

- [ ] **Step 2: 実行して FAIL 確認**
- [ ] **Step 3: 実装**

auth.ts:

```ts
export const claimLimiter = new RateLimiter(10, 15 * 60 * 1000);
// ...
.post('/claim', requirePasswordAuth, validate('json', claimSchema), async (c) => {
  const { email, code, password } = c.req.valid('json');
  if (!claimLimiter.consume(email.toLowerCase())) {
    throw new AppError('RATE_LIMITED', '試行回数が上限に達しました。しばらくしてから再試行してください', 429);
  }
  const result = await claimAccount(c.get('db'), { email, code, password });
  if (!result) {
    throw new AppError('CLAIM_INVALID', '登録コードまたはメールアドレスが正しくありません', 400);
  }
  setSessionCookie(c, result.sid, c.get('config'));
  return c.json(result.user);
})
```

admin.ts（`.use(requireAuth, requireCan('user:manage'))` 配下に追加。CSV 2 本は既存 `/users/import` と同じ `bodyLimit(5MB)` + `parseBody` + `CSV_IMPORT_FAILED` 整形）:

```ts
.get('/registration-code', async (c) => c.json(await getActiveCodeMeta(c.get('db'))))
.post('/registration-code', validate('json', issueRegistrationCodeSchema), async (c) =>
  c.json(await issueRegistrationCode(c.get('db'), c.req.valid('json').expiresInDays), 201))
.delete('/registration-code', async (c) => {
  await revokeActiveCode(c.get('db'));
  return c.body(null, 204);
})
.post('/users', validate('json', adminCreateUserSchema), async (c) =>
  c.json(await createPendingUser(c.get('db'), c.req.valid('json')), 201))
.post('/users/registrations/import', bodyLimit({ maxSize: 5 * 1024 * 1024, onError: /* 既存と同一 */ }), async (c) => {
  /* 既存 /users/import と同じ file 取り出し → importUserRegistrations → ok/errors 整形 */
})
.post('/users/deactivate', validate('json', deactivateUsersSchema), async (c) =>
  c.json(await deactivateUsers(c.get('db'), c.req.valid('json').userIds)))
.post('/users/deactivate/import', bodyLimit({ /* 同上 */ }), async (c) => {
  /* importUserDeactivations → ok/errors 整形 */
})
.delete('/users/:id', async (c) => {
  requireUuidParam(c.req.param('id'), 'ユーザーが見つかりません');
  await deletePendingUser(c.get('db'), c.req.param('id'));
  return c.body(null, 204);
})
.post('/users/:id/unclaim', async (c) => {
  requireUuidParam(c.req.param('id'), 'ユーザーが見つかりません');
  return c.json(await unclaimUser(c.get('db'), c.req.param('id')));
})
```

- [ ] **Step 4: テスト PASS 確認 + `docs/api.md` を spec §10 の表どおり更新**（招待行は Task 3 で削除済み。OIDC callback の備考に JIT 廃止を反映）
- [ ] **Step 5: Commit** `feat: wire claim and admin provisioning routes`

---

### Task 11: Web — /claim ページとログイン導線

**Files:**
- Create: `apps/web/src/pages/ClaimPage.tsx`
- Modify: `apps/web/src/App.tsx`（`{ path: '/claim', element: <ClaimPage /> }` 追加）
- Modify: `apps/web/src/pages/LoginPage.tsx`（password 有効時のみ `/claim` への Link）
- Modify: `docs/screens.md`
- Test: `apps/web/src/pages/ClaimPage.test.tsx`

**Interfaces:**
- Consumes: `api.api.auth.claim.$post({ json: { email, code, password } })`（hc 型は Task 10 の AppType から推論）、`AuthShell` / `Button` / `Input` / `Label`、`errorMessage` / `NETWORK_ERROR_MESSAGE`
- Produces: 公開ページ `/claim`。成功で `navigate('/')`（自動ログイン済み）。

- [ ] **Step 1: 失敗するテストを書く**（旧 InvitePage テストがあればその流儀）

```tsx
it('成功で / へ遷移する', async () => { /* $post 200 を msw/fetch mock、フォーム入力 → navigate 検証 */ });
it('失敗時はサーバーのメッセージを role=alert で表示する', async () => { /* 400 CLAIM_INVALID */ });
```

- [ ] **Step 2: 実行して FAIL 確認**
- [ ] **Step 3: 実装**（旧 InvitePage と同構造。フィールドは email / 登録コード / パスワード）

```tsx
export function ClaimPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.api.auth.claim.$post({ json: { email, code, password } });
      if (!res.ok) { setError(await errorMessage(res, '登録に失敗しました')); return; }
    } catch { setError(NETWORK_ERROR_MESSAGE); return; }
    navigate('/');
  }

  return (
    <AuthShell title="アカウント登録">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {/* Label+Input: claim-email(メールアドレス, type=email) / claim-code(登録コード) /
            claim-password(パスワード（12文字以上）, type=password, minLength 12) — 旧 InvitePage の markup 踏襲 */}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit">登録する</Button>
      </form>
    </AuthShell>
  );
}
```

LoginPage: 既存の methods 取得（`/api/auth/methods`）で `password` が有効な場合のみ、フォーム下に
`<Link to="/claim" className="text-sm underline">初めてご利用の方（登録コードをお持ちの方）</Link>` を表示。

- [ ] **Step 4: `pnpm --filter @knowledge-hub/web test` PASS + `docs/screens.md` に /claim 追加・/invite 削除を反映**
- [ ] **Step 5: Commit** `feat: add claim page and login link`

---

### Task 12: Web — 管理画面（登録コード・ユーザー追加・一括無効化・pending 操作）

**Files:**
- Modify: `apps/web/src/pages/AdminUsersPage.tsx`（分量次第で `apps/web/src/components/admin/` にセクション切り出し可: `RegistrationCodePanel.tsx` / `AddUserForm.tsx` / `UserCsvImports.tsx`）
- Modify: `docs/screens.md`
- Test: `apps/web/src/pages/AdminUsersPage.test.tsx`（追記）

**Interfaces:**
- Consumes: Task 10 の admin API 一式（hc 経由）。`AdminUserView.authProvider === 'pending'` でバッジ判定。
- Produces: 管理画面に以下を追加:
  1. **登録コードパネル**: `GET registration-code` のメタ表示（有効期限・発行日時 or「有効なコードはありません」）。「発行」（期限 7/30/90 選択）→ 応答の平文コードを **1 回だけ** コピー可能表示（「このコードは再表示できません」）。「失効」ボタン（confirm）。
  2. **ユーザーを追加**: email / 表示名（+ 任意の所属・役職・入社年）→ `POST /users` → 一覧 refetch。
  3. **CSV インポート 2 種**: 既存 org インポート UI の隣に「登録 CSV」「無効化 CSV」（`file` フィールド、エラーは既存の行番号付き表示を流用）。
  4. **一覧**: 各行チェックボックス + 「選択したユーザーを無効化」（confirm ダイアログ、`POST /users/deactivate`）。`authProvider === 'pending'` 行に「未ログイン」バッジ + 行メニューに「削除」（pending のみ・confirm）。claimed 行に「未ログインに戻す」（confirm 文言: 「このユーザーは再クレームまでログインできず、名簿に表示されなくなります（記事等のコンテンツは残ります）」）。
- 全ミューテーションは try/catch + `errorMessage` / `NETWORK_ERROR_MESSAGE`（既存パターン）。

- [ ] **Step 1: 失敗するテストを書く**（代表 4 ケース: コード発行で平文表示／追加フォームで一覧更新／チェック選択 → 一括無効化 API 呼び出し／pending バッジ表示と削除・unclaim の出し分け）
- [ ] **Step 2: 実行して FAIL 確認**
- [ ] **Step 3: 実装**（AdminUsersPage の既存構造・useQuery/refetch・Button/Input/Label/Dialog の流儀を踏襲。237 行に大きく足すのでセクションはコンポーネント分割を推奨）
- [ ] **Step 4: `pnpm --filter @knowledge-hub/web test` PASS + `pnpm --filter @knowledge-hub/web check:contrast`（新規色ペアを足した場合のみ追加）+ `docs/screens.md` 追従**
- [ ] **Step 5: Commit** `feat: add admin provisioning and bulk deactivation UI`

---### Task 13: E2E 書き換え（setup / sso / クレームフロー）

**Files:**
- Modify: `tests/e2e/setup/auth.setup.ts`（招待 + Mailpit → 事前作成 + クレーム）
- Modify: `tests/e2e/specs/sso.spec.ts`（pending 事前作成 + 行なし拒否の負テスト）
- Modify: `tests/e2e/specs/auth.spec.ts`（招待関連の記述があれば削除）
- Modify: `tests/e2e/helpers/data.ts`（必要なら SSO ユーザー email 定数追加）

**Interfaces:**
- Consumes: `POST /api/admin/registration-code`（応答 `{ code, expiresAt }`）、`POST /api/admin/users`、`/claim` ページ（Task 11 のラベル）
- Produces: E2E 全 spec green（メール依存は password リセット系のみに縮小）

- [ ] **Step 1: auth.setup.ts を書き換え**

```ts
setup('admin ログインと member クレーム（storageState 準備）', async ({ page, browser }) => {
  // admin ログイン → storageState（既存のまま）
  // member: 既存ならログイン、なければ事前作成 + 登録コードクレーム（クレームフローの検証を兼ねる）
  const probe = await memberContext.request.post('/api/auth/login', { data: { email: MEMBER.email, password: MEMBER.password }, headers: { origin: BASE } });
  if (!probe.ok()) {
    const codeRes = await page.request.post('/api/admin/registration-code', { data: { expiresInDays: 7 } });
    const { code } = await codeRes.json();
    const createRes = await page.request.post('/api/admin/users', { data: { email: MEMBER.email, displayName: MEMBER.name } });
    expect(createRes.status(), 'member の事前作成').toBe(201);
    const memberPage = await memberContext.newPage();
    await memberPage.goto('/claim');
    await memberPage.getByLabel('メールアドレス').fill(MEMBER.email);
    await memberPage.getByLabel('登録コード').fill(code);
    await memberPage.getByLabel('パスワード（12文字以上）').fill(MEMBER.password);
    await memberPage.getByRole('button', { name: '登録する' }).click();
    await expect(memberPage).toHaveURL('/');
    await memberPage.close();
  }
  await memberContext.storageState({ path: '.auth/member.json' });
});
```

（`clearMailbox` / `latestMessageText` の import を削除。mailpit ヘルパー自体は password リセット系が使っていれば残す）

- [ ] **Step 2: sso.spec.ts を修正**（SSO ログイン前に admin request で `POST /api/admin/users { email: 'sso-taro@example.com', displayName: 'Taro SSO' }` を実行し 201 または 409(EMAIL_TAKEN=作成済み) を許容。負テスト追加: 事前作成していないランダム email の Keycloak ユーザーは… IdP 側ユーザー追加が必要なため、**代替**として「pending 事前行なしの状態で SSO → アプリにセッションが作られない（`/` に到達しない・エラー表示）」を、事前作成ステップを飛ばした 2 つ目の Keycloak ユーザーがいる場合のみ実施。realm に 2 人目がいなければ負テストは service テスト（Task 6）でカバー済みとして省略可）
- [ ] **Step 3: `pnpm run e2e:up && pnpm run e2e` で全 spec green を確認**（クリーン状態から）
- [ ] **Step 4: Commit** `test: rewrite e2e onboarding to claim flow`

---

### Task 14: 最終検証

- [ ] **Step 1: `pnpm run verify` exit 0 を確認**（typecheck → 全テスト → contrast → web build）
- [ ] **Step 2: E2E フル（`pnpm run e2e:down && pnpm run e2e:up && pnpm run e2e`）green を確認**
- [ ] **Step 3: docs 整合の最終確認**（`docs/api.md` / `docs/screens.md` が spec §10/§11 と一致、README のセットアップ記述に招待前提の記述が残っていないか grep）
- [ ] **Step 4: Commit（必要な修正があれば）** + 進捗台帳 `.superpowers/sdd/progress.md` 更新

## Self-Review（作成時実施済み）

- spec 全節とタスクの対応: §3→T2/T3、§4→T4、§5.1→T5/T10/T11、§5.2→T6、§6→T7/T10/T12、§7→T8/T10/T12、§8→T9/T10/T12、§9→T3、§10→T10、§11→T11/T12、§12→T5/T10（統一エラー・RL・ハッシュ）、§13→各タスク+T13、docs 追従→T3/T10/T11/T12。ギャップなし。
- 型整合: `claimAccount`/`deactivateUsers`/`unclaimUser`/`createPendingUser` のシグネチャは定義タスクと消費タスク（T10）で一致。`toAdminView` の export 化は T7 に明記。
- 順序: T2（enum）→ T3（invitations drop）は分離済み（T3 時点で invitation-service を同時撤去するためコンパイル断絶なし）。E2E は T3 で壊れ T13 で復旧（それまで unit verify のみ）。
