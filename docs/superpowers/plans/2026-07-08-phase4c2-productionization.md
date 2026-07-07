# Phase 4c-2: 本番化仕上げ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番投入前必須の M-6（SMTP 認証/TLS）・M-7（production fail-fast + serveStatic 絶対パス + HSTS）と、正確性バックログ 6 件（M-1/M-3/M-10/M-5/保存表示二重/タイトル空公開）を修正し、C 群を理由付きでクローズする。

**Architecture:** サーバー側は config（zod スキーマ＋相関バリデーション）を単一の入口として fail-fast を集約。HSTS は securityHeaders を factory 化して nodeEnv で分岐。トークン単回使用は「条件付き UPDATE で先にトークンを claim する tx」パターン（I-2 の db.transaction 前例に従う）。web 側は既存のエラー表示規約（`role="alert"`）に未処理経路を合流させるだけで新規 UI は作らない。

**Tech Stack:** zod / nodemailer 9 / Hono middleware / drizzle tx（Testcontainers 実 DB テスト）/ React 19 + RTL。

## Global Constraints

- コミットは英語 Conventional Commits。TDD（RED→GREEN、回帰テストを先に書く）。
- **パスワード・トークンをログに出さない**（SMTP_PASSWORD 含む）。
- 既存の公開 API・エラー形（AppError {code,message,status}）・UI 文言規約（destructive・role=alert）を維持。
- 各タスク末尾で該当パッケージのテスト緑。全タスク後に `pnpm run verify` ＋ **E2E フルスイート**（`pnpm run e2e:down && pnpm run e2e:up && pnpm run e2e`）緑。
- ブランチ: `feat/phase4c2-productionization`（main から作成）。

## 確認済みの現状（実コード採取）

- `config.ts`: `emptyAsUndefined` ヘルパと OIDC 3 点相関チェックの前例あり。S3 認証情報は default `'minioadmin'`。
- `mailer.ts`: `createTransport({ host, port, secure: false })`・認証なし。
- `security-headers.ts`: `export const securityHeaders: MiddlewareHandler` を `app.ts:44` が `.use(securityHeaders)` で配線。`middleware/security-headers.test.ts` あり。
- `index.ts:27-28`: `serveStatic({ root: '../web/dist' })`（cwd 依存）。`index.ts:15`: `allowInsecure: config.nodeEnv !== 'production'` — **production で必ず false（4b DEFER #6 は現状で正しい。検証記録のみ）**。
- `categoryUpdateSchema`（packages/shared/src/schemas/article.ts:27）: `{ name?, sortOrder? }` で refine なし → `{}` が通り 500。
- `password-reset-service.ts` / `invitation-service.ts`: 検証（findFirst）→ 使用済み化（無条件 UPDATE）の check-then-act。invitation は user INSERT の**後**に usedAt 更新。
- `category-service.ts deleteCategory`: 記事ありガードは `isNull(deletedAt)` のみ → **ゴミ箱内 published のみのカテゴリは無条件削除でき、tx で categoryId=NULL に付け替え → restore で「published なのに categoryId NULL」**（M-10 実証パス）。
- `EditorPage save()`: 成功時 `setStatus('保存しました')` ×2 箇所（キャンバス表示）と、アクションバー `savingLabel` の二重表示。

---

### Task 0: ブランチ作成

- [ ] `git switch -c feat/phase4c2-productionization`（main から）

---

### Task 1: M-6 — SMTP 認証/TLS

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/services/mailer.ts`
- Test: `apps/server/src/config.test.ts`（存在しなければ新規）
- Test: `apps/server/src/services/mailer.test.ts`（新規）

**Interfaces:**
- Produces: `Config` に `smtpUser?: string; smtpPassword?: string; smtpSecure: boolean` を追加。`createSmtpMailer` のシグネチャ・`Mailer` 型は不変。

- [ ] **Step 1: 失敗するテストを書く（config 相関 + mailer transport 引数）**

`config.test.ts` に追加（既存ファイルのスタイルに合わせる。無ければ `loadConfig` を直接叩く新規ファイル）:

```ts
const BASE = { DATABASE_URL: 'postgres://x' };

it('SMTP_USER だけ設定されていると起動時エラー', () => {
  expect(() => loadConfig({ ...BASE, SMTP_USER: 'mailer' })).toThrow(/SMTP_USER \/ SMTP_PASSWORD/);
});

it('SMTP_USER と SMTP_PASSWORD が揃っていれば auth 設定として読める', () => {
  const c = loadConfig({ ...BASE, SMTP_USER: 'mailer', SMTP_PASSWORD: 'secret-pass', SMTP_SECURE: 'true' });
  expect(c.smtpUser).toBe('mailer');
  expect(c.smtpPassword).toBe('secret-pass');
  expect(c.smtpSecure).toBe(true);
});

it('SMTP 認証未設定なら従来どおり（auth なし・secure false）', () => {
  const c = loadConfig(BASE);
  expect(c.smtpUser).toBeUndefined();
  expect(c.smtpSecure).toBe(false);
});
```

`mailer.test.ts`（新規、nodemailer をモックし createTransport 引数を検証）:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTransportMock = vi.fn(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: (...a: unknown[]) => createTransportMock(...a) } }));

import { createSmtpMailer } from './mailer';
import { loadConfig } from '../config';

describe('createSmtpMailer', () => {
  beforeEach(() => createTransportMock.mockClear());

  it('認証未設定なら auth を渡さない（Mailpit 互換）', () => {
    createSmtpMailer(loadConfig({ DATABASE_URL: 'postgres://x' }));
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, auth: undefined }),
    );
  });

  it('SMTP_USER/PASSWORD/SECURE を transport に渡す', () => {
    createSmtpMailer(loadConfig({
      DATABASE_URL: 'postgres://x', SMTP_USER: 'mailer', SMTP_PASSWORD: 'secret-pass', SMTP_SECURE: 'true',
    }));
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, auth: { user: 'mailer', pass: 'secret-pass' } }),
    );
  });
});
```

- [ ] **Step 2: RED を確認** — `pnpm --filter @knowledge-hub/server test -- config` / `-- mailer` が FAIL

- [ ] **Step 3: config.ts を実装**

envSchema に追加（OIDC 群の直前あたり）:

```ts
  SMTP_USER: emptyAsUndefined(z.string().min(1).optional()),
  SMTP_PASSWORD: emptyAsUndefined(z.string().min(1).optional()),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
```

`Config` 型に `smtpUser?: string; smtpPassword?: string; smtpSecure: boolean;` を追加。`loadConfig` に相関チェック（OIDC と同じ形式）:

```ts
  const smtpAuthSet = [e.SMTP_USER, e.SMTP_PASSWORD].filter((v) => v !== undefined).length;
  if (smtpAuthSet === 1) {
    throw new Error('SMTP_USER / SMTP_PASSWORD は両方設定するか、両方未設定にしてください');
  }
```

return に `smtpUser: e.SMTP_USER, smtpPassword: e.SMTP_PASSWORD, smtpSecure: e.SMTP_SECURE === 'true',` を追加。

- [ ] **Step 4: mailer.ts を実装**

```ts
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth:
      config.smtpUser !== undefined && config.smtpPassword !== undefined
        ? { user: config.smtpUser, pass: config.smtpPassword }
        : undefined,
  });
```

- [ ] **Step 5: GREEN 確認 + server 全テスト** — `pnpm --filter @knowledge-hub/server test`
- [ ] **Step 6: Commit** — `feat(server): support smtp auth and tls for production mailers`

---

### Task 2: M-7 — production fail-fast + HSTS + serveStatic 絶対パス

**Files:**
- Modify: `apps/server/src/config.ts`（production fail-fast）
- Modify: `apps/server/src/middleware/security-headers.ts`（factory 化 + HSTS）
- Modify: `apps/server/src/app.ts:44`（factory 呼び出し）
- Modify: `apps/server/src/index.ts`（serveStatic パス解決）
- Test: `apps/server/src/config.test.ts` / `apps/server/src/middleware/security-headers.test.ts`

**Interfaces:**
- Produces: `securityHeaders(options: { hsts: boolean }): MiddlewareHandler<AppEnv>`（**破壊的変更**: const → factory。呼び出しは app.ts の 1 箇所のみ）。

- [ ] **Step 1: 失敗するテストを書く**

config.test.ts:

```ts
it('production では S3 認証情報が既定値のままだと起動時エラー', () => {
  expect(() => loadConfig({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production' })).toThrow(/S3_ACCESS_KEY_ID/);
});

it('production でも S3 認証情報を明示すれば起動できる', () => {
  const c = loadConfig({
    DATABASE_URL: 'postgres://x', NODE_ENV: 'production',
    S3_ACCESS_KEY_ID: 'AKIAEXAMPLE', S3_SECRET_ACCESS_KEY: 'real-secret',
  });
  expect(c.nodeEnv).toBe('production');
});
```

security-headers.test.ts: 既存テストを factory 呼び出しに追随させ（`securityHeaders({ hsts: false })`）、追加:

```ts
it('hsts: true で Strict-Transport-Security を付与する', async () => {
  // 既存テストと同じ app 組み立てで securityHeaders({ hsts: true }) を使い、
  res.headers.get('Strict-Transport-Security') === 'max-age=31536000; includeSubDomains'
});

it('hsts: false（開発）では Strict-Transport-Security を付与しない', async () => {
  // ヘッダが null であることを確認
});
```

（実装時に既存テストの組み立て方を読んで同じ形式で書く。アサーション内容は上記のとおり固定。）

- [ ] **Step 2: RED 確認**

- [ ] **Step 3: config.ts に production fail-fast**

`loadConfig` の相関チェック群に追加:

```ts
  if (e.NODE_ENV === 'production' && (e.S3_ACCESS_KEY_ID === 'minioadmin' || e.S3_SECRET_ACCESS_KEY === 'minioadmin')) {
    throw new Error('production では S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY の明示設定が必要です（開発用既定値では起動できません）');
  }
```

- [ ] **Step 4: securityHeaders を factory 化**

```ts
export function securityHeaders(options: { hsts: boolean }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('Content-Security-Policy', CSP);
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // HSTS は https 前提の本番のみ。開発の http に配ると以後ブラウザが http を拒否して事故る。
    if (options.hsts) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  };
}
```

app.ts:44 を `.use(securityHeaders({ hsts: deps.config.nodeEnv === 'production' }))` に変更。

- [ ] **Step 5: index.ts の serveStatic を cwd 非依存に**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
```

```ts
// ビルド済み SPA の場所を import.meta 基準で解決し、起動 cwd に依存しないようにする。
// （@hono/node-server の serveStatic は相対パス前提のため cwd からの相対に正規化して渡す）
const webDistAbs = process.env.WEB_DIST_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
const webDistRel = path.relative(process.cwd(), webDistAbs) || '.';
app.use('*', serveStatic({ root: webDistRel }));
app.get('*', serveStatic({ path: path.join(webDistRel, 'index.html') }));
```

- [ ] **Step 6: GREEN 確認 + serveStatic の実地スモーク**

1. `pnpm --filter @knowledge-hub/server test`
2. **リポジトリルートから**（cwd 非依存の証明）: `apps/server/node_modules/.bin/tsx --env-file=apps/server/.env.e2e apps/server/src/index.ts` をバックグラウンド起動 → `curl -s http://localhost:53000/ | head -1` が `<!doctype html>` を返す（4c-1 の e2e スタック稼働が前提。事前に `pnpm --filter @knowledge-hub/web build`）→ プロセス停止。

- [ ] **Step 7: Commit** — `feat(server): production fail-fast, hsts, and cwd-independent static root`

---

### Task 3: M-1 + M-10 — カテゴリの正確性 2 件

**Files:**
- Modify: `packages/shared/src/schemas/article.ts:27-30`（categoryUpdateSchema）
- Modify: `apps/server/src/services/category-service.ts`（deleteCategory ガード）
- Test: `packages/shared` の schema テスト / `apps/server/src/routes/categories.test.ts` / `apps/server/src/services/category-service.test.ts`

**Interfaces:**
- Consumes/Produces: API 形は不変（`{}` が 500 → 400 に、削除ガードが 1 ケース増えるのみ）。

- [ ] **Step 1: 失敗するテストを書く**

shared（既存 schema テストファイルに追加）:

```ts
it('categoryUpdateSchema は空オブジェクトを拒否する', () => {
  expect(categoryUpdateSchema.safeParse({}).success).toBe(false);
  expect(categoryUpdateSchema.safeParse({ name: '新名称' }).success).toBe(true);
  expect(categoryUpdateSchema.safeParse({ sortOrder: 2 }).success).toBe(true);
});
```

server routes（categories.test.ts、既存の admin 認証ヘルパを使う）:

```ts
it('PATCH /api/categories/:id は空ボディを 400 で拒否する', async () => {
  // admin セッションで PATCH {} → 400, body.code === 'VALIDATION'
});
```

service（category-service.test.ts）:

```ts
it('ゴミ箱内の公開記事だけを持つカテゴリは移行先なしで削除できない', async () => {
  // カテゴリ作成 → 記事作成+publish → softDelete → deleteCategory(id) が CATEGORY_NOT_EMPTY(409)
});

it('移行先を指定すればゴミ箱内公開記事も付け替えられ、restore 後もカテゴリが有効', async () => {
  // deleteCategory(id, other.id) → restoreArticle → 記事の categoryId === other.id
});
```

- [ ] **Step 2: RED 確認**

- [ ] **Step 3: schema に refine**

```ts
export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => v.name !== undefined || v.sortOrder !== undefined, {
    message: 'name か sortOrder のいずれかを指定してください',
  });
```

- [ ] **Step 4: deleteCategory のガードを拡張**

`or` を drizzle-orm import に追加し、記事ありチェックの where を:

```ts
    // 生きている記事に加え、ゴミ箱内の公開記事もガード対象にする。
    // （ゴミ箱内 published を categoryId=NULL に付け替えると、restore で
    //   「公開記事はカテゴリ必須」の不変条件が壊れるため）
    .where(and(eq(articles.categoryId, id), or(isNull(articles.deletedAt), eq(articles.status, 'published'))))
```

- [ ] **Step 5: GREEN 確認**（shared + server 全テスト）
- [ ] **Step 6: Commit** — `fix(server): reject empty category patch and guard trashed published articles on delete`

---

### Task 4: M-3 — リセット/招待トークンの単回使用をアトミックに

**Files:**
- Modify: `apps/server/src/services/password-reset-service.ts`（resetPassword）
- Modify: `apps/server/src/services/invitation-service.ts`（acceptInvitation）
- Test: 各サービスの既存 test ファイルに並行 2 重使用の回帰テスト

**Interfaces:**
- 公開シグネチャ・エラー形は不変（並行 2 回目が確実に `INVALID_TOKEN` 400 になるだけ）。

**パターン（両サービス共通）**: 「条件付き UPDATE（`usedAt IS NULL` を WHERE に含める）でトークンを claim → 0 行なら INVALID_TOKEN」を **db.transaction 内**で行い、後続処理（パスワード更新 / ユーザー作成）も同 tx に入れて失敗時は claim ごとロールバックする。2 本目の tx は行ロックで待たされ、1 本目 commit 後に 0 行ヒット → 拒否。

- [ ] **Step 1: 失敗するテストを書く（並行 2 重使用）**

password-reset-service.test.ts（既存のテストヘルパ/factory を使う）:

```ts
it('同一トークンの並行使用は片方だけ成功する', async () => {
  // ユーザー作成 → requestPasswordReset 相当でトークン行を直接 insert（既存テストの手法に合わせる）
  const results = await Promise.allSettled([
    resetPassword(db, token, 'new-password-aaa1'),
    resetPassword(db, token, 'new-password-bbb2'),
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const ng = results.filter((r) => r.status === 'rejected');
  expect(ok).toHaveLength(1);
  expect(ng).toHaveLength(1);
  expect((ng[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'INVALID_TOKEN' });
});
```

invitation-service.test.ts:

```ts
it('同一招待トークンの並行受諾は片方だけ成功し、ユーザーは 1 人だけ作られる', async () => {
  const results = await Promise.allSettled([
    acceptInvitation(db, token, { displayName: 'A', password: 'password-aaaa-1' }),
    acceptInvitation(db, token, { displayName: 'B', password: 'password-bbbb-2' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  expect(rejected).toHaveLength(1);
  expect(rejected[0].reason).toMatchObject({ code: 'INVALID_TOKEN' }); // 500 や EMAIL_TAKEN ではなく
  const rows = await db.query.users.findMany({ where: eq(users.email, invEmail) });
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: RED 確認**（現実装ではどちらも両方成功 or 片方 500 になり FAIL）

- [ ] **Step 3: resetPassword を tx + claim に**

```ts
export async function resetPassword(db: Db, token: string, newPassword: string): Promise<void> {
  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, hashToken(token)),
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError('INVALID_TOKEN', 'リンクが無効か、期限切れです', 400);
  }
  const user = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!user || user.authProvider !== 'password' || !user.isActive) {
    // トークン発行後に SSO 連携や無効化が発生したケース。列挙攻撃対策として通常の
    // 無効トークンと同一メッセージを返し、トークンも消費しない。
    throw new AppError('INVALID_TOKEN', 'リンクが無効か、期限切れです', 400);
  }
  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    // 条件付き UPDATE でトークンを claim（並行使用の 2 本目はここで 0 行になり拒否）
    const claimed = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (claimed.length === 0) {
      throw new AppError('INVALID_TOKEN', 'リンクが無効か、期限切れです', 400);
    }
    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await deleteUserSessions(tx, row.userId);
  });
}
```

import に `isNull` を追加。`deleteUserSessions(tx, ...)` の第一引数型が合わない場合は tx 外（transaction 後）で `deleteUserSessions(db, row.userId)` のままにする（セッション削除はベストエフォートで可、claim とパスワード更新のアトミック性が本質）。

- [ ] **Step 4: acceptInvitation を tx + claim に**

既存の検証（expiry/EMAIL_TAKEN 事前チェック）はそのまま、user INSERT と usedAt 更新を tx 化し、**claim を INSERT の前**に移す:

```ts
  const passwordHash = await hashPassword(input.password);
  const user = await db.transaction(async (tx) => {
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
```

import に `and, isNull` を追加。

- [ ] **Step 5: GREEN 確認**（server 全テスト。既存の単発トークンテストが緑のままであること）
- [ ] **Step 6: Commit** — `fix(server): make reset and invitation token consumption atomic`

---

### Task 5: エディタ仕上げ — 保存表示一本化 + タイトル空公開ガード

**Files:**
- Modify: `apps/web/src/pages/EditorPage.tsx`
- Test: `apps/web/src/pages/EditorPage.test.tsx`

**Interfaces:**
- 保存完了の表示はアクションバー `savingLabel`（保存済み）に一本化。`status` は情報メッセージ（「Markdown モードで開きました」等）専用。公開パネルの実行ボタンは `!categoryId || !title.trim()` で disabled。

- [ ] **Step 1: テストを新挙動へ書き換え + 追加（RED）**

EditorPage.test.tsx:
- 既存の `getByText('保存しました')` アサーション 2 箇所（race テストと保存状態テスト）を `getByText('保存済み', { exact: true })` に変更。保存完了を示す表示の検証は維持（弱めない）。
- 追加:

```ts
  it('保存成功後、キャンバス側に「保存しました」は表示しない（バーに一本化）', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-05T00:00:00Z' }) });
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }));
    await waitFor(() => expect(screen.getByText('保存済み', { exact: true })).toBeInTheDocument());
    expect(screen.queryByText('保存しました')).not.toBeInTheDocument();
  });

  it('公開パネルはタイトル未入力だと公開実行ボタンが無効で理由を表示する', async () => {
    renderNew();
    await userEvent.click(screen.getByRole('button', { name: '公開する' })); // タイトル空のままパネルを開く
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'エンジニアリング' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/カテゴリ/), 'c1'); // カテゴリは選んでも
    expect(within(dialog).getByRole('button', { name: '公開する' })).toBeDisabled();
    expect(within(dialog).getByText(/タイトルの入力が必要/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: RED 確認**

- [ ] **Step 3: EditorPage.tsx を実装**

- `save()` 内の成功 2 箇所から `setStatus('保存しました');` を削除（`setUpdatedAt(...)` は残す）。
- 公開パネルのカテゴリガードの隣にタイトルガードを追加:

```tsx
            <div className="grid gap-1.5">
              <Label htmlFor="publish-category">カテゴリ<span className="ml-1 text-destructive">*必須</span></Label>
              <CategorySelect id="publish-category" value={categoryId} onChange={setCategoryId} />
              {!categoryId && <p className="text-xs text-destructive">公開にはカテゴリの選択が必要です</p>}
              {!title.trim() && <p className="text-xs text-destructive">公開にはタイトルの入力が必要です</p>}
            </div>
```

- 実行ボタン: `disabled={!categoryId || !title.trim()}`

- [ ] **Step 4: GREEN 確認**（web 全テスト）
- [ ] **Step 5: Commit** — `fix(web): single save indicator and title guard in publish panel`

---

### Task 6: M-5 — web ミューテーションの fetch 例外の掃除

**Files:**
- Modify: 走査で確定（候補: `LoginPage.tsx` / `InvitePage.tsx` / `PasswordReset*Page.tsx` / `ArticleDetailPage.tsx` / `ReactionBar.tsx` / `BookmarkButton.tsx` / `CommentSection.tsx` / `SettingsPage.tsx` / `AdminUsersPage.tsx` / `AdminCategoriesPage.tsx` / `NotificationsPage.tsx`）
- Test: 代表 4 箇所（LoginPage / ArticleDetailPage / ReactionBar / BookmarkButton）に reject 時の alert 表示テスト

**手順:**

- [ ] **Step 1: 走査** — `grep -n "\$post(\|\$patch(\|\$delete(" apps/web/src` の各ハンドラについて、`await api...` が try/catch（またはエラーを表示に落とす仕組み）に包まれているかを目視確認し、未処理の一覧を作る（React Query の useMutation onError 経由のものは処理済みとみなす）。
- [ ] **Step 2: 代表テストを書く（RED）** — 例（LoginPage）:

```ts
it('ネットワーク例外でもエラーメッセージを表示する', async () => {
  loginMock.mockRejectedValue(new TypeError('fetch failed'));
  render(...);
  // メール/パスワード入力 → 送信
  expect(await screen.findByRole('alert')).toHaveTextContent(/通信に失敗/);
});
```

- [ ] **Step 3: 統一パターンで修正** — 各ハンドラを try/catch し、**そのファイル既存のエラー state**（`setError` / `actionError` 等）に `'通信に失敗しました。時間をおいて再試行してください'` を流す。エラー表示が無いコンポーネント（ReactionBar 等）は最小の `role="alert"` テキストを追加（既存の CommentSection のエラー表示様式に合わせる）。**成功パス・res.ok 分岐は変更しない。**
- [ ] **Step 4: GREEN 確認**（web 全テスト + typecheck + check:contrast）
- [ ] **Step 5: Commit** — `fix(web): surface network failures in mutation handlers`

---

### Task 7: C 群クローズ記録 + 最終検証

**Files:**
- Modify: `.superpowers/sdd/progress.md`（C 群クローズの記録）
- Modify: `README.md`（4c-2 を [x]、WIP 行更新）

- [ ] **Step 1: C 群を台帳に記録**（各項目 1 行: 内容 → 判断（クローズ/将来）→ 理由）
- [ ] **Step 2: `pnpm run verify`** — exit 0（全パッケージ）
- [ ] **Step 3: E2E フルスイート** — `pnpm run e2e:down && pnpm run e2e:up && pnpm run e2e` 全緑（サーバー変更後の安全網確認。web build は e2e script が実施）
- [ ] **Step 4: README 更新 + Commit** — `docs: mark phase 4c-2 productionization complete in readme`（README は merge 後 main で行っても良い）

---

## 最終確認（マージ前）

- [ ] verify exit 0 / E2E 10 テスト green / dev スタック無影響
- [ ] 最終セルフレビュー（ブランチ全 diff 精査）→ `--no-ff` merge + tree 同一性検証 + ブランチ削除。push はユーザー判断（しない）

## Self-Review（計画 vs spec）

- **§2 M-6**: Task 1（env 3 種・相関チェック・transport 引数・ログ非出力は「config を丸ごとログしない」現状維持）✓
- **§3 M-7**: Task 2（fail-fast=minioadmin 既定値検出／HSTS=factory 化で production のみ・preload なし／serveStatic=import.meta 基準+cwd 相対正規化+WEB_DIST_DIR、ルート起動スモークで受け入れ基準を検証）。§3.4 allowInsecure は**現状で正しいことをコード確認済み**（index.ts:15、production→false）— 専用テストは entry ファイルで費用対効果が低く「検証記録」で満たす（spec の「必要なら最小修正」に該当なし）✓
- **§4.1 M-1**: Task 3（実フィールドは name/sortOrder — spec の「parentId」は記憶違いで実体に合わせた）✓
- **§4.2 M-3**: Task 4（条件付き UPDATE claim + tx、並行テストは Promise.allSettled で片方 INVALID_TOKEN・ユーザー 1 人）✓
- **§4.3 M-10**: Task 3（ガードに「ゴミ箱内 published」を追加、restore 後の有効性テスト）✓
- **§4.4 M-5**: Task 6（走査手順+統一パターン+代表テスト 4 箇所）✓
- **§4.5/4.6**: Task 5（保存しました削除・バー一本化・タイトルガード。既存アサーションは保存済みへ追随し強度維持）✓
- **§5 C 群**: Task 7 Step 1 ✓／**§6 検証**: verify+E2E フル ✓
- **型整合**: `securityHeaders({hsts})` の呼び出しは app.ts 1 箇所のみ変更。`Config` 追加フィールドは additive。プレースホルダなし（Task 6 の対象一覧のみ走査で確定と明示、修正パターン・テストは具体）✓
