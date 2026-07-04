# knowledge-hub フェーズ1: 基盤・認証・ユーザー管理 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pnpm モノレポ + Docker 開発環境の上に、パスワード認証（招待制・リセット付き）とユーザー管理を備えた「ログインして使える」社内ポータルの骨格を作る。

**Architecture:** Hono（REST API + SPA 配信）+ Vite/React SPA + PostgreSQL(Drizzle) の単一コンテナ構成。API は `buildApp()` ファクトリで依存注入し、Testcontainers の実 PostgreSQL で統合テストする。認証は DB セッション + httpOnly Cookie。

**Tech Stack:** Node.js 22 / TypeScript / pnpm workspace / Hono 4 / Drizzle ORM / PostgreSQL 16 / Vite 6 + React 19 / TanStack Query / Vitest + Testcontainers / nodemailer + Mailpit

**このフェーズでやらないこと:** OIDC（フェーズ4）、記事関連すべて（フェーズ2）、検索・通知（フェーズ3）、アバター画像アップロード（S3 導入と同時=フェーズ2）、CI（フェーズ4）。

## Global Constraints

- Node.js 22 / ESM（全 package.json に `"type": "module"`）/ TypeScript strict
- API エラー形式は全エンドポイント統一: `{ code, message, details? }`（code は shared の `ErrorCode`）
- パスワードは 12 文字以上（shared の `passwordSchema` が唯一の定義箇所）
- セッション Cookie: 名前 `sid`、httpOnly、SameSite=Lax、path=/、本番のみ Secure、有効期間 30 日
- DB: 主キーは `uuid` (gen_random_uuid)、時刻は `timestamptz`
- トークン（セッション・招待・リセット）は平文を DB に置かず sha256 ハッシュで保存
- UI 文言は日本語。コミットメッセージは英語 Conventional Commits
- ユーザー無効化・パスワード変更/リセット時は該当ユーザーの既存セッションを全失効（スペック §5）

## ファイル構成（このフェーズで作るもの）

```
knowledge-hub/
├── package.json / pnpm-workspace.yaml / tsconfig.base.json / .gitignore / .env.example
├── docker-compose.yml
├── docker/db/{Dockerfile,init.sql}
├── packages/shared/src/{index.ts,errors.ts,types.ts,schemas/auth.ts}
├── apps/server/
│   ├── drizzle.config.ts / vitest.config.ts / drizzle/（生成SQL）
│   └── src/
│       ├── index.ts（起動エントリ・SPA配信） / app.ts（buildApp） / config.ts / logger.ts / errors.ts / types.ts
│       ├── db/{client.ts,schema.ts}
│       ├── middleware/{error-handler.ts,validate.ts,origin-check.ts,session.ts}
│       ├── services/{password.ts,rate-limiter.ts,session-service.ts,auth-service.ts,invitation-service.ts,password-reset-service.ts,user-service.ts,permissions.ts,mailer.ts}
│       ├── routes/{health.ts,auth.ts,users.ts,admin.ts}
│       ├── scripts/seed-admin.ts
│       └── test/{global-setup.ts,helpers.ts,factories.ts,vitest.d.ts}
└── apps/web/
    ├── index.html / vite.config.ts
    └── src/
        ├── main.tsx / App.tsx / styles.css
        ├── api/client.ts
        ├── auth/{useMe.ts,RequireAuth.tsx}
        ├── components/Layout.tsx
        ├── pages/{LoginPage.tsx,InvitePage.tsx,PasswordResetRequestPage.tsx,PasswordResetConfirmPage.tsx,HomePage.tsx,SettingsPage.tsx,AdminUsersPage.tsx}
        └── test/setup.ts
```

---

### Task 1: モノレポ基盤

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`

**Interfaces:**
- Produces: workspace `@knowledge-hub/shared` / `@knowledge-hub/server` / `@knowledge-hub/web`（以降のタスクはこの名前で --filter する）

- [ ] **Step 1: ルートファイル一式を作成**

`package.json`:
```json
{
  "name": "knowledge-hub",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "forceConsistentCasingInFileNames": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
coverage/
.env
*.local
.DS_Store
```

`.env.example`:
```
DATABASE_URL=postgres://khub:khub@localhost:5432/khub
APP_URL=http://localhost:5173
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=knowledge-hub@example.com
PASSWORD_AUTH_ENABLED=true
# seed:admin 用
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-please-12
ADMIN_NAME=管理者
```

- [ ] **Step 2: 検証**

Run: `pnpm install`
Expected: エラーなく完了（workspace はまだ空で良い）

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm monorepo"
```

---

### Task 2: Docker 開発環境（PostgreSQL + Mailpit）

**Files:**
- Create: `docker/db/Dockerfile`, `docker/db/init.sql`, `docker-compose.yml`

**Interfaces:**
- Produces: `postgres://khub:khub@localhost:5432/khub`（pg_bigm / pgvector 拡張入り）、SMTP localhost:1025（Mailpit UI: http://localhost:8025）

- [ ] **Step 1: DB イメージ定義を作成**

`docker/db/Dockerfile`（pg_bigm はフェーズ3の全文検索用、pgvector は将来 RAG 用。イメージは一度作れば以降触らないため今仕込む）:
```dockerfile
FROM postgres:16-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-16-pgvector build-essential postgresql-server-dev-16 ca-certificates curl \
 && curl -fsSL https://github.com/pgbigm/pg_bigm/archive/refs/tags/v1.2-20240606.tar.gz | tar -xz -C /tmp \
 && cd /tmp/pg_bigm-1.2-20240606 && make USE_PGXS=1 && make USE_PGXS=1 install \
 && apt-get purge -y build-essential postgresql-server-dev-16 curl \
 && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* /tmp/pg_bigm*
```

`docker/db/init.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS pg_bigm;
CREATE EXTENSION IF NOT EXISTS vector;
```

`docker-compose.yml`:
```yaml
services:
  db:
    build: ./docker/db
    environment:
      POSTGRES_USER: khub
      POSTGRES_PASSWORD: khub
      POSTGRES_DB: khub
    ports:
      - "5432:5432"
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./docker/db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U khub"]
      interval: 5s
      timeout: 3s
      retries: 10
  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "1025:1025"
      - "8025:8025"
volumes:
  db-data: {}
```

- [ ] **Step 2: 起動と拡張の確認**

Run: `docker compose up -d --build && sleep 5 && docker compose exec db psql -U khub -c "select extname from pg_extension;"`
Expected: 一覧に `pg_bigm` と `vector` が含まれる（pg_bigm のタグが 404 の場合は https://github.com/pgbigm/pg_bigm/tags で最新の v1.2 系タグに差し替える）

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "build: add docker dev environment with pg_bigm and pgvector"
```

---

### Task 3: shared パッケージ（エラーコード・型・auth スキーマ）

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/{index.ts,errors.ts,types.ts,schemas/auth.ts}`
- Test: `packages/shared/src/schemas/auth.test.ts`

**Interfaces:**
- Produces: `ErrorCode`, `ApiError`, `Role`, `SessionUser`, `passwordSchema`, `loginSchema`, `inviteSchema`, `acceptInvitationSchema`, `passwordResetRequestSchema`, `passwordResetConfirmSchema`, `changePasswordSchema`, `updateProfileSchema`, `updateUserByAdminSchema`（全タスクが `@knowledge-hub/shared` から import）

- [ ] **Step 1: パッケージ定義**

`packages/shared/package.json`:
```json
{
  "name": "@knowledge-hub/shared",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^3.24.1" },
  "devDependencies": { "typescript": "^5.7.2", "vitest": "^3.0.4" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/shared/src/schemas/auth.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { acceptInvitationSchema, loginSchema } from './auth';

describe('auth schemas', () => {
  it('loginSchema は正しい入力を受理する', () => {
    expect(loginSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true);
  });
  it('acceptInvitationSchema は 11 文字のパスワードを拒否する', () => {
    const r = acceptInvitationSchema.safeParse({ displayName: '太郎', password: 'a'.repeat(11) });
    expect(r.success).toBe(false);
  });
  it('acceptInvitationSchema は 12 文字のパスワードを受理する', () => {
    const r = acceptInvitationSchema.safeParse({ displayName: '太郎', password: 'a'.repeat(12) });
    expect(r.success).toBe(true);
  });
});
```

Run: `pnpm install && pnpm --filter @knowledge-hub/shared test`
Expected: FAIL（`./auth` が存在しない）

- [ ] **Step 3: 実装**

`packages/shared/src/errors.ts`:
```ts
export const ERROR_CODES = [
  'VALIDATION', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
  'INVALID_CREDENTIALS', 'RATE_LIMITED', 'EMAIL_TAKEN', 'INVALID_TOKEN',
  'LAST_ADMIN', 'PASSWORD_AUTH_DISABLED', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ApiError = { code: ErrorCode; message: string; details?: unknown };
```

`packages/shared/src/types.ts`:
```ts
export type Role = 'member' | 'admin';
export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  avatarUrl: string | null;
  bio: string;
};
```

`packages/shared/src/schemas/auth.ts`:
```ts
import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(12, 'パスワードは12文字以上で入力してください')
  .max(200);

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const inviteSchema = z.object({ email: z.string().email() });
export const acceptInvitationSchema = z.object({
  displayName: z.string().min(1).max(50),
  password: passwordSchema,
});
export const passwordResetRequestSchema = z.object({ email: z.string().email() });
export const passwordResetConfirmSchema = z.object({ password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50),
  bio: z.string().max(2000),
});
export const updateUserByAdminSchema = z
  .object({
    role: z.enum(['member', 'admin']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, {
    message: '変更内容を指定してください',
  });
```

`packages/shared/src/index.ts`:
```ts
export * from './errors';
export * from './types';
export * from './schemas/auth';
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/shared test`
Expected: PASS（3 件）

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add shared package with error codes and auth schemas"
```

---

### Task 4: server スケルトン（config / エラーハンドラ / healthz）

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`, `apps/server/src/{config.ts,logger.ts,errors.ts,types.ts,app.ts}`, `apps/server/src/middleware/{error-handler.ts,validate.ts,origin-check.ts}`, `apps/server/src/routes/health.ts`
- Test: `apps/server/src/routes/health.test.ts`, `apps/server/src/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(source?): Config`（camelCase 設定）、`AppError(code, message, status)`、`buildApp(deps: { db; config; mailer }): Hono`、`AppEnv`（Hono の Variables 型: `db` / `config` / `mailer` / `user`）、`validate(target, schema)`（統一 400 応答の zValidator ラッパ）
- 注: この時点では `db` / `mailer` は型だけ先行定義し、Task 5 / 10 で実体が入る。healthz の DB チェックは Task 5 で追加。

- [ ] **Step 1: パッケージ定義**

`apps/server/package.json`:
```json
{
  "name": "@knowledge-hub/server",
  "private": true,
  "type": "module",
  "exports": { "./app": "./src/app.ts" },
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "start": "tsx --env-file=.env src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "seed:admin": "tsx --env-file=.env src/scripts/seed-admin.ts"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "@hono/zod-validator": "^0.4.2",
    "@knowledge-hub/shared": "workspace:*",
    "drizzle-orm": "^0.38.3",
    "hono": "^4.6.16",
    "nodemailer": "^6.9.16",
    "pg": "^8.13.1",
    "pino": "^9.6.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10.16.0",
    "@types/node": "^22.10.5",
    "@types/nodemailer": "^6.4.17",
    "@types/pg": "^8.11.10",
    "dotenv": "^16.4.7",
    "drizzle-kit": "^0.30.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^3.0.4"
  }
}
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "drizzle.config.ts", "vitest.config.ts"]
}
```

`apps/server/vitest.config.ts`（globalSetup は Task 5 で追加するため、まずは最小）:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
```

- [ ] **Step 2: 失敗するテストを書く**

`apps/server/src/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('デフォルト値を補完して camelCase で返す', () => {
    const c = loadConfig(base);
    expect(c.port).toBe(3000);
    expect(c.appUrl).toBe('http://localhost:5173');
    expect(c.passwordAuthEnabled).toBe(true);
  });
  it('PASSWORD_AUTH_ENABLED=false を解釈する', () => {
    expect(loadConfig({ ...base, PASSWORD_AUTH_ENABLED: 'false' }).passwordAuthEnabled).toBe(false);
  });
  it('DATABASE_URL がないと throw する', () => {
    expect(() => loadConfig({})).toThrow();
  });
});
```

`apps/server/src/routes/health.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { testConfig } from '../test/helpers';

describe('GET /healthz', () => {
  it('200 と status:ok を返す', async () => {
    const app = buildApp({ db: null as never, config: testConfig(), mailer: null as never });
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
```

Run: `pnpm install && pnpm --filter @knowledge-hub/server test`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

`apps/server/src/config.ts`:
```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:5173'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_FROM: z.string().default('knowledge-hub@example.com'),
  PASSWORD_AUTH_ENABLED: z.enum(['true', 'false']).default('true'),
});

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  appUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpFrom: string;
  passwordAuthEnabled: boolean;
};

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const e = envSchema.parse(source);
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    appUrl: e.APP_URL,
    smtpHost: e.SMTP_HOST,
    smtpPort: e.SMTP_PORT,
    smtpFrom: e.SMTP_FROM,
    passwordAuthEnabled: e.PASSWORD_AUTH_ENABLED === 'true',
  };
}
```

`apps/server/src/logger.ts`:
```ts
import { pino } from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
```

`apps/server/src/errors.ts`:
```ts
import type { ErrorCode } from '@knowledge-hub/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: ContentfulStatusCode = 400,
  ) {
    super(message);
  }
}
```

`apps/server/src/types.ts`（`Db` / `Mailer` は先行して型名だけ参照; Task 5 / 10 で定義するファイルへの import。Task 5 完了までは一時的に `any` エイリアスのプレースホルダーファイルを作らず、このファイル自体を Task 5 で完成させる。今タスクでは下記の暫定版を置く）:
```ts
import type { Config } from './config';
import type { SessionUser } from '@knowledge-hub/shared';

// Task 5 で db/client.ts の Db に、Task 10 で services/mailer.ts の Mailer に差し替える
export type Db = unknown;
export type Mailer = unknown;

export type AppEnv = {
  Variables: { db: Db; config: Config; mailer: Mailer; user: SessionUser };
};
```

`apps/server/src/middleware/error-handler.ts`:
```ts
import type { ErrorHandler } from 'hono';
import { AppError } from '../errors';
import { logger } from '../logger';
import type { AppEnv } from '../types';

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof AppError) {
    return c.json({ code: err.code, message: err.message }, err.status);
  }
  logger.error({ err }, 'unhandled error');
  return c.json({ code: 'INTERNAL', message: 'サーバーエラーが発生しました' }, 500);
};
```

`apps/server/src/middleware/validate.ts`:
```ts
import { zValidator } from '@hono/zod-validator';

export const validate = ((target: never, schema: never) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        { code: 'VALIDATION', message: '入力内容に誤りがあります', details: result.error.flatten() },
        400,
      );
    }
  })) as typeof zValidator;
```

`apps/server/src/middleware/origin-check.ts`:
```ts
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';

export const originCheck = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.get('config').appUrl).origin) {
      return c.json({ code: 'FORBIDDEN', message: '不正なリクエスト元です' }, 403);
    }
  }
  await next();
});
```

`apps/server/src/routes/health.ts`:
```ts
import { Hono } from 'hono';
import type { AppEnv } from '../types';

export const healthRoutes = new Hono<AppEnv>().get('/', (c) => c.json({ status: 'ok' }));
```

`apps/server/src/app.ts`:
```ts
import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { originCheck } from './middleware/origin-check';
import { healthRoutes } from './routes/health';
import type { Config } from './config';
import type { AppEnv, Db, Mailer } from './types';

export function buildApp(deps: { db: Db; config: Config; mailer: Mailer }) {
  return new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('db', deps.db);
      c.set('config', deps.config);
      c.set('mailer', deps.mailer);
      await next();
    })
    .use(originCheck)
    .onError(errorHandler)
    .route('/healthz', healthRoutes);
}

export type AppType = ReturnType<typeof buildApp>;
```

`apps/server/src/test/helpers.ts`（暫定版。Task 5 で DB 付きに拡張）:
```ts
import type { Config } from '../config';

export function testConfig(): Config {
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl: 'unused-in-tests',
    appUrl: 'http://localhost:5173',
    smtpHost: 'localhost',
    smtpPort: 1025,
    smtpFrom: 'test@example.com',
    passwordAuthEnabled: true,
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test`
Expected: PASS（config 3 件 + healthz 1 件）

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add hono server skeleton with unified error handling"
```

---

### Task 5: Drizzle スキーマ・マイグレーション・テスト DB 基盤

**Files:**
- Create: `apps/server/drizzle.config.ts`, `apps/server/src/db/{client.ts,schema.ts}`, `apps/server/src/test/{global-setup.ts,vitest.d.ts}`, `apps/server/drizzle/`（drizzle-kit が生成）
- Modify: `apps/server/src/types.ts`（Db/Mailer の暫定型を実型に）, `apps/server/vitest.config.ts`（globalSetup 追加）, `apps/server/src/routes/health.ts`（DB チェック追加）, `apps/server/src/test/helpers.ts`（DB 付きテストコンテキスト）
- Test: `apps/server/src/db/schema.test.ts`

**Interfaces:**
- Produces: `createDb(databaseUrl): { pool, db }`、`type Db`、テーブル `users` / `sessions` / `invitations` / `passwordResetTokens`、`createTestApp(): { app, db, pool, mailer }`、`resetDb(db)`、`createFakeMailer()`
- Consumes: Task 4 の `buildApp` / `testConfig`

- [ ] **Step 1: スキーマと DB クライアントを書く**

`apps/server/src/db/schema.ts`:
```ts
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  bio: text('bio').notNull().default(''),
  role: text('role', { enum: ['member', 'admin'] }).notNull().default('member'),
  authProvider: text('auth_provider', { enum: ['oidc', 'password'] }).notNull(),
  passwordHash: text('password_hash'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256(sid) hex
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`apps/server/src/db/client.ts`:
```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type Db = ReturnType<typeof createDb>['db'];
```

`apps/server/drizzle.config.ts`:
```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://khub:khub@localhost:5432/khub' },
});
```

`apps/server/src/types.ts` を更新（暫定型を差し替え。Mailer は Task 10 まで最小定義をここに置く）:
```ts
import type { Config } from './config';
import type { SessionUser } from '@knowledge-hub/shared';
import type { Db } from './db/client';

export type Mailer = {
  send(to: string, subject: string, text: string): Promise<void>;
};

export type AppEnv = {
  Variables: { db: Db; config: Config; mailer: Mailer; user: SessionUser };
};
export type { Db };
```

- [ ] **Step 2: マイグレーション生成**

Run: `pnpm --filter @knowledge-hub/server db:generate`
Expected: `apps/server/drizzle/0000_*.sql` が生成され、4 テーブルの CREATE TABLE を含む

- [ ] **Step 3: テスト基盤（Testcontainers）を書く**

`apps/server/src/test/global-setup.ts`:
```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await pool.end();
  project.provide('dbUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}
```

`apps/server/src/test/vitest.d.ts`:
```ts
declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
  }
}
export {};
```

`apps/server/vitest.config.ts` を更新:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    globalSetup: ['./src/test/global-setup.ts'],
  },
});
```

`apps/server/src/test/helpers.ts` を全面更新:
```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp } from '../app';
import type { Config } from '../config';
import * as schema from '../db/schema';
import type { Db, Mailer } from '../types';

export function testConfig(): Config {
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl: 'unused-in-tests',
    appUrl: 'http://localhost:5173',
    smtpHost: 'localhost',
    smtpPort: 1025,
    smtpFrom: 'test@example.com',
    passwordAuthEnabled: true,
  };
}

export type SentMail = { to: string; subject: string; text: string };

export function createFakeMailer(): Mailer & { sent: SentMail[] } {
  const sent: SentMail[] = [];
  return {
    sent,
    async send(to, subject, text) {
      sent.push({ to, subject, text });
    },
  };
}

export function createTestApp() {
  const pool = new pg.Pool({ connectionString: inject('dbUrl') });
  const db: Db = drizzle(pool, { schema });
  const mailer = createFakeMailer();
  const app = buildApp({ db, config: testConfig(), mailer });
  return { app, db, pool, mailer };
}

export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate table users, sessions, invitations, password_reset_tokens cascade`,
  );
}
```

- [ ] **Step 4: 失敗するテストを書く → 通す**

`apps/server/src/db/schema.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from './schema';
import { createTestApp, resetDb } from '../test/helpers';

describe('db schema', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('users を insert して select できる', async () => {
    const [row] = await ctx.db
      .insert(users)
      .values({ email: 'a@example.com', displayName: '太郎', authProvider: 'password' })
      .returning();
    expect(row.id).toMatch(/[0-9a-f-]{36}/);
    expect(row.role).toBe('member');
    expect(row.isActive).toBe(true);
  });

  it('email はユニーク制約違反で reject される', async () => {
    const v = { email: 'dup@example.com', displayName: 'A', authProvider: 'password' as const };
    await ctx.db.insert(users).values(v);
    await expect(ctx.db.insert(users).values(v)).rejects.toThrow();
  });
});
```

`apps/server/src/routes/health.ts` を DB チェック付きに更新:
```ts
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../types';

export const healthRoutes = new Hono<AppEnv>().get('/', async (c) => {
  await c.get('db').execute(sql`select 1`);
  return c.json({ status: 'ok' });
});
```

`apps/server/src/routes/health.test.ts` を実 DB 版に更新:
```ts
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test/helpers';

describe('GET /healthz', () => {
  const ctx = createTestApp();
  afterAll(() => ctx.pool.end());

  it('DB 接続込みで 200 を返す', async () => {
    const res = await ctx.app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test`
Expected: PASS（Docker が動いていること。初回はコンテナ pull で時間がかかる）

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add drizzle schema, migrations and testcontainers setup"
```

---

### Task 6: パスワードハッシュ（scrypt）とテストファクトリ

**Files:**
- Create: `apps/server/src/services/password.ts`, `apps/server/src/test/factories.ts`
- Test: `apps/server/src/services/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`、`verifyPassword(plain: string, stored: string): Promise<boolean>`、`createTestUser(db, overrides?)`（users の insert 済み row を返す）、`TEST_PASSWORD`（factories のデフォルトパスワード。以降の統合テストが使用）
- 形式: `scrypt:<salt base64url>:<hash base64url>`。依存パッケージなし（node:crypto のみ）

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/password.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('正しいパスワードを検証できる', async () => {
    const stored = await hashPassword('my-secret-password');
    expect(await verifyPassword('my-secret-password', stored)).toBe(true);
  });
  it('誤ったパスワードを拒否する', async () => {
    const stored = await hashPassword('my-secret-password');
    expect(await verifyPassword('wrong-password-here', stored)).toBe(false);
  });
  it('同じ平文でもソルトによりハッシュが異なる', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
  it('不正な形式の保存値は false を返す', async () => {
    expect(await verifyPassword('x', 'broken-value')).toBe(false);
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/password.test.ts`
Expected: FAIL

- [ ] **Step 2: 実装**

`apps/server/src/services/password.ts`:
```ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(plain, salt, 64);
  return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split(':');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = await scrypt(plain, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

- [ ] **Step 3: テストファクトリを追加**

`apps/server/src/test/factories.ts`（hashPassword に依存するためこのタスクで作成。Task 7 以降の統合テストが使う）:
```ts
import { randomUUID } from 'node:crypto';
import { users } from '../db/schema';
import { hashPassword } from '../services/password';
import type { Db } from '../types';

export const TEST_PASSWORD = 'correct-horse-battery';

export async function createTestUser(
  db: Db,
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const [row] = await db
    .insert(users)
    .values({
      email: `u-${randomUUID()}@example.com`,
      displayName: 'テスト太郎',
      authProvider: 'password',
      passwordHash: await hashPassword(TEST_PASSWORD),
      ...overrides,
    })
    .returning();
  return row;
}
```

- [ ] **Step 4: テストと typecheck が通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test src/services/password.test.ts && pnpm --filter @knowledge-hub/server typecheck`
Expected: PASS（4 件）、typecheck エラーなし

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add scrypt password hashing and test factories"
```

---

### Task 7: セッションサービスとパスワードログイン

**Files:**
- Create: `apps/server/src/services/{session-service.ts,auth-service.ts}`
- Test: `apps/server/src/services/session-service.test.ts`, `apps/server/src/services/auth-service.test.ts`

**Interfaces:**
- Produces:
  - `hashToken(token: string): string`（sha256 hex。招待・リセットでも再利用）
  - `createSession(db, userId): Promise<string>`（戻り値は平文 sid）
  - `getSessionUser(db, sid): Promise<SessionUser | null>`（期限切れ・無効ユーザーは null）
  - `deleteSession(db, sid)` / `deleteUserSessions(db, userId)`
  - `toSessionUser(row: typeof users.$inferSelect): SessionUser`
  - `loginWithPassword(db, email, password): Promise<{ sid: string; user: SessionUser } | null>`
- Consumes: Task 5 の schema/テスト基盤、Task 6 の verifyPassword

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/session-service.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sessions } from '../db/schema';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import {
  createSession, deleteSession, deleteUserSessions, getSessionUser, hashToken,
} from './session-service';

describe('session service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('セッションを作成し sid でユーザーを取得できる', async () => {
    const user = await createTestUser(ctx.db);
    const sid = await createSession(ctx.db, user.id);
    const su = await getSessionUser(ctx.db, sid);
    expect(su?.id).toBe(user.id);
    expect(su?.email).toBe(user.email);
  });

  it('DB には sid のハッシュのみ保存される', async () => {
    const user = await createTestUser(ctx.db);
    const sid = await createSession(ctx.db, user.id);
    const rows = await ctx.db.select().from(sessions);
    expect(rows[0].id).toBe(hashToken(sid));
    expect(rows[0].id).not.toBe(sid);
  });

  it('期限切れセッションは null', async () => {
    const user = await createTestUser(ctx.db);
    const sid = await createSession(ctx.db, user.id);
    await ctx.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, hashToken(sid)));
    expect(await getSessionUser(ctx.db, sid)).toBeNull();
  });

  it('無効化されたユーザーのセッションは null', async () => {
    const user = await createTestUser(ctx.db, { isActive: false });
    const sid = await createSession(ctx.db, user.id);
    expect(await getSessionUser(ctx.db, sid)).toBeNull();
  });

  it('deleteUserSessions で全セッションが消える', async () => {
    const user = await createTestUser(ctx.db);
    const sid1 = await createSession(ctx.db, user.id);
    const sid2 = await createSession(ctx.db, user.id);
    await deleteUserSessions(ctx.db, user.id);
    expect(await getSessionUser(ctx.db, sid1)).toBeNull();
    expect(await getSessionUser(ctx.db, sid2)).toBeNull();
  });

  it('deleteSession は単一セッションのみ消す', async () => {
    const user = await createTestUser(ctx.db);
    const sid1 = await createSession(ctx.db, user.id);
    const sid2 = await createSession(ctx.db, user.id);
    await deleteSession(ctx.db, sid1);
    expect(await getSessionUser(ctx.db, sid1)).toBeNull();
    expect(await getSessionUser(ctx.db, sid2)).not.toBeNull();
  });
});
```

`apps/server/src/services/auth-service.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { loginWithPassword } from './auth-service';

describe('loginWithPassword', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('正しい資格情報で sid と user を返す', async () => {
    const user = await createTestUser(ctx.db, { email: 'a@example.com' });
    const result = await loginWithPassword(ctx.db, 'a@example.com', TEST_PASSWORD);
    expect(result?.user.id).toBe(user.id);
    expect(result?.sid).toBeTruthy();
  });

  it('誤ったパスワードは null', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    expect(await loginWithPassword(ctx.db, 'a@example.com', 'wrong-password-x')).toBeNull();
  });

  it('存在しないメールは null', async () => {
    expect(await loginWithPassword(ctx.db, 'no@example.com', TEST_PASSWORD)).toBeNull();
  });

  it('無効化ユーザーは null', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com', isActive: false });
    expect(await loginWithPassword(ctx.db, 'a@example.com', TEST_PASSWORD)).toBeNull();
  });

  it('oidc ユーザー（passwordHash なし）は null', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com', authProvider: 'oidc', passwordHash: null });
    expect(await loginWithPassword(ctx.db, 'a@example.com', TEST_PASSWORD)).toBeNull();
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services`
Expected: FAIL（session-service / auth-service 未作成）

- [ ] **Step 2: 実装**

`apps/server/src/services/session-service.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { sessions, users } from '../db/schema';
import type { Db } from '../types';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toSessionUser(row: typeof users.$inferSelect): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
  };
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const sid = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    id: hashToken(sid),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return sid;
}

export async function getSessionUser(db: Db, sid: string): Promise<SessionUser | null> {
  const rows = await db
    .select()
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, hashToken(sid)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.sessions.expiresAt < new Date()) {
    await deleteSession(db, sid);
    return null;
  }
  if (!row.users.isActive) return null;
  return toSessionUser(row.users);
}

export async function deleteSession(db: Db, sid: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(sid)));
}

export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
```

`apps/server/src/services/auth-service.ts`:
```ts
import { eq } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { users } from '../db/schema';
import type { Db } from '../types';
import { verifyPassword } from './password';
import { createSession, toSessionUser } from './session-service';

export async function loginWithPassword(
  db: Db,
  email: string,
  password: string,
): Promise<{ sid: string; user: SessionUser } | null> {
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user || !user.isActive || user.authProvider !== 'password' || !user.passwordHash) {
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  const sid = await createSession(db, user.id);
  return { sid, user: toSessionUser(user) };
}
```

- [ ] **Step 3: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test src/services`
Expected: PASS（session 6 件 + auth 5 件 + password 4 件）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add session service and password login"
```

---

### Task 8: 認証 API（login / logout / me + レートリミット）

**Files:**
- Create: `apps/server/src/services/rate-limiter.ts`, `apps/server/src/middleware/session.ts`, `apps/server/src/routes/auth.ts`
- Modify: `apps/server/src/app.ts`（`.route('/api/auth', authRoutes)` 追加）
- Test: `apps/server/src/services/rate-limiter.test.ts`, `apps/server/src/routes/auth.test.ts`

**Interfaces:**
- Produces:
  - `RateLimiter(max, windowMs)` — `consume(key): boolean` / `reset()`。`loginLimiter`（10 回/15 分、email 単位）を auth ルートが使用
  - `requireAuth` ミドルウェア（Cookie の sid を検証し `c.set('user', ...)`。失敗時 401）
  - `setSessionCookie(c, sid, config)`（Global Constraints の Cookie 属性で設定）
  - HTTP: `POST /api/auth/login` → 200 SessionUser / 401 / 429、`POST /api/auth/logout` → 204、`GET /api/auth/me` → 200 SessionUser / 401
- Consumes: Task 7 のセッション/ログイン、Task 4 の validate / AppError

- [ ] **Step 1: RateLimiter の失敗するテストを書く**

`apps/server/src/services/rate-limiter.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('上限までは許可し、超えたら拒否する', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.consume('k')).toBe(true);
    expect(rl.consume('k')).toBe(true);
    expect(rl.consume('k')).toBe(true);
    expect(rl.consume('k')).toBe(false);
  });
  it('ウィンドウ経過後は再び許可する', () => {
    const rl = new RateLimiter(1, 1000);
    const t0 = 1_000_000;
    expect(rl.consume('k', t0)).toBe(true);
    expect(rl.consume('k', t0 + 500)).toBe(false);
    expect(rl.consume('k', t0 + 1001)).toBe(true);
  });
  it('キーごとに独立してカウントする', () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('b')).toBe(true);
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/rate-limiter.test.ts`
Expected: FAIL

- [ ] **Step 2: RateLimiter を実装**

`apps/server/src/services/rate-limiter.ts`（単一プロセス前提のインメモリ実装。100 人規模ではこれで足りる — 水平スケール時は要差し替え）:
```ts
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}
```

Run: `pnpm --filter @knowledge-hub/server test src/services/rate-limiter.test.ts`
Expected: PASS（3 件）

- [ ] **Step 3: 認証 API の失敗するテストを書く**

`apps/server/src/routes/auth.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { loginLimiter } from './auth';

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  };
}

describe('auth routes', () => {
  const ctx = createTestApp();
  beforeEach(async () => {
    await resetDb(ctx.db);
    loginLimiter.reset();
  });
  afterAll(() => ctx.pool.end());

  it('login 成功で SessionUser と Set-Cookie を返す', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com', displayName: '太郎' });
    const res = await ctx.app.request('/api/auth/login', json({ email: 'a@example.com', password: TEST_PASSWORD }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe('太郎');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('sid=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('誤った資格情報は 401 INVALID_CREDENTIALS', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const res = await ctx.app.request('/api/auth/login', json({ email: 'a@example.com', password: 'wrong-password' }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('INVALID_CREDENTIALS');
  });

  it('11 回目のログイン試行は 429', async () => {
    for (let i = 0; i < 10; i++) {
      await ctx.app.request('/api/auth/login', json({ email: 'rl@example.com', password: 'wrong-password' }));
    }
    const res = await ctx.app.request('/api/auth/login', json({ email: 'rl@example.com', password: 'wrong-password' }));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe('RATE_LIMITED');
  });

  it('me は Cookie 付きで SessionUser を返し、無しは 401', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const login = await ctx.app.request('/api/auth/login', json({ email: 'a@example.com', password: TEST_PASSWORD }));
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const me = await ctx.app.request('/api/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await me.json()).email).toBe('a@example.com');
    expect((await ctx.app.request('/api/auth/me')).status).toBe(401);
  });

  it('logout 後は me が 401', async () => {
    await createTestUser(ctx.db, { email: 'a@example.com' });
    const login = await ctx.app.request('/api/auth/login', json({ email: 'a@example.com', password: TEST_PASSWORD }));
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    await ctx.app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect((await ctx.app.request('/api/auth/me', { headers: { cookie } })).status).toBe(401);
  });

  it('別オリジンからの POST は 403', async () => {
    const res = await ctx.app.request('/api/auth/login', {
      ...json({ email: 'a@example.com', password: 'x' }),
      headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/routes/auth.test.ts`
Expected: FAIL（routes/auth 未作成）

- [ ] **Step 4: 実装**

`apps/server/src/middleware/session.ts`:
```ts
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Config } from '../config';
import { getSessionUser } from '../services/session-service';
import type { AppEnv } from '../types';

export function setSessionCookie(c: Context<AppEnv>, sid: string, config: Config): void {
  setCookie(c, 'sid', sid, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: config.nodeEnv === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, 'sid', { path: '/' });
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const sid = getCookie(c, 'sid');
  if (sid) {
    const user = await getSessionUser(c.get('db'), sid);
    if (user) {
      c.set('user', user);
      return next();
    }
  }
  return c.json({ code: 'UNAUTHORIZED', message: 'ログインが必要です' }, 401);
});
```

`apps/server/src/routes/auth.ts`:
```ts
import { getCookie } from 'hono/cookie';
import { Hono } from 'hono';
import { loginSchema } from '@knowledge-hub/shared';
import { AppError } from '../errors';
import { requireAuth, setSessionCookie, clearSessionCookie } from '../middleware/session';
import { validate } from '../middleware/validate';
import { loginWithPassword } from '../services/auth-service';
import { RateLimiter } from '../services/rate-limiter';
import { deleteSession } from '../services/session-service';
import type { AppEnv } from '../types';

export const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);

export const authRoutes = new Hono<AppEnv>()
  .post('/login', validate('json', loginSchema), async (c) => {
    const config = c.get('config');
    if (!config.passwordAuthEnabled) {
      throw new AppError('PASSWORD_AUTH_DISABLED', 'パスワードログインは無効化されています', 403);
    }
    const { email, password } = c.req.valid('json');
    if (!loginLimiter.consume(email.toLowerCase())) {
      throw new AppError('RATE_LIMITED', '試行回数が上限に達しました。しばらくしてから再試行してください', 429);
    }
    const result = await loginWithPassword(c.get('db'), email, password);
    if (!result) {
      throw new AppError('INVALID_CREDENTIALS', 'メールアドレスまたはパスワードが正しくありません', 401);
    }
    setSessionCookie(c, result.sid, config);
    return c.json(result.user);
  })
  .post('/logout', async (c) => {
    const sid = getCookie(c, 'sid');
    if (sid) await deleteSession(c.get('db'), sid);
    clearSessionCookie(c);
    return c.body(null, 204);
  })
  .get('/me', requireAuth, (c) => c.json(c.get('user')));
```

`apps/server/src/app.ts` の buildApp チェーンに追加:
```ts
import { authRoutes } from './routes/auth';
// ...
    .route('/healthz', healthRoutes)
    .route('/api/auth', authRoutes);
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add login/logout/me endpoints with rate limiting"
```

---

### Task 9: 権限チェック can() と requireAdmin

**Files:**
- Create: `apps/server/src/services/permissions.ts`, `apps/server/src/middleware/admin.ts`
- Test: `apps/server/src/services/permissions.test.ts`

**Interfaces:**
- Produces: `type Action = 'user:manage'`（フェーズ2で `'article:edit'` 等を追加拡張）、`can(user: SessionUser, action: Action): boolean`、`requireAdmin` ミドルウェア（requireAuth の後段で使用。403 FORBIDDEN）
- Consumes: shared の `SessionUser`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/permissions.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '@knowledge-hub/shared';
import { can } from './permissions';

const user = (role: 'member' | 'admin'): SessionUser => ({
  id: '1', email: 'a@example.com', displayName: 'A', role, avatarUrl: null, bio: '',
});

describe('can', () => {
  it('admin は user:manage できる', () => {
    expect(can(user('admin'), 'user:manage')).toBe(true);
  });
  it('member は user:manage できない', () => {
    expect(can(user('member'), 'user:manage')).toBe(false);
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/permissions.test.ts`
Expected: FAIL

- [ ] **Step 2: 実装**

`apps/server/src/services/permissions.ts`:
```ts
import type { SessionUser } from '@knowledge-hub/shared';

// フェーズ2以降: 'article:edit' | 'article:delete' 等を追加し、resource 引数を導入する
export type Action = 'user:manage';

export function can(user: SessionUser, action: Action): boolean {
  switch (action) {
    case 'user:manage':
      return user.role === 'admin';
  }
}
```

`apps/server/src/middleware/admin.ts`:
```ts
import { createMiddleware } from 'hono/factory';
import { can } from '../services/permissions';
import type { AppEnv } from '../types';

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!can(c.get('user'), 'user:manage')) {
    return c.json({ code: 'FORBIDDEN', message: 'この操作には管理者権限が必要です' }, 403);
  }
  await next();
});
```

- [ ] **Step 3: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test src/services/permissions.test.ts`
Expected: PASS（2 件）

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add permission check and admin middleware"
```

---

### Task 10: メール送信と招待フロー

**Files:**
- Create: `apps/server/src/services/{mailer.ts,invitation-service.ts}`
- Modify: `apps/server/src/types.ts`（Mailer を mailer.ts から re-export）, `apps/server/src/routes/auth.ts`（招待受諾エンドポイント追加）, `apps/server/src/app.ts`（admin ルートは Task 12 でまとめて追加するため、ここでは auth のみ）
- Test: `apps/server/src/services/invitation-service.test.ts`, `apps/server/src/routes/auth.test.ts`（受諾エンドポイントのケース追記）

**Interfaces:**
- Produces:
  - `type Mailer = { send(to, subject, text): Promise<void> }`、`createSmtpMailer(config): Mailer`（nodemailer）
  - `createInvitation(db, mailer, config, email): Promise<void>`（既存ユーザーなら AppError EMAIL_TAKEN 409。メール本文に `${config.appUrl}/invite/<token>` を含む。有効期限 7 日）
  - `acceptInvitation(db, token, { displayName, password }): Promise<{ sid; user }>`（無効/期限切れ/使用済みは AppError INVALID_TOKEN 400。ユーザー作成 + セッション発行）
  - HTTP: `POST /api/auth/invitations/:token/accept` → 200 SessionUser + Set-Cookie
- Consumes: Task 7 の hashToken/createSession/toSessionUser、Task 6 の hashPassword

- [ ] **Step 1: mailer を実装（外部 I/O の薄いラッパのためテストは Fake で代替、実配信は Step 5 で手動確認）**

`apps/server/src/services/mailer.ts`:
```ts
import nodemailer from 'nodemailer';
import type { Config } from '../config';

export type Mailer = {
  send(to: string, subject: string, text: string): Promise<void>;
};

export function createSmtpMailer(config: Config): Mailer {
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: false,
  });
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: config.smtpFrom, to, subject, text });
    },
  };
}
```

`apps/server/src/types.ts` の `Mailer` 定義を削除し re-export に変更:
```ts
import type { Config } from './config';
import type { SessionUser } from '@knowledge-hub/shared';
import type { Db } from './db/client';
import type { Mailer } from './services/mailer';

export type AppEnv = {
  Variables: { db: Db; config: Config; mailer: Mailer; user: SessionUser };
};
export type { Db, Mailer };
```

- [ ] **Step 2: 招待サービスの失敗するテストを書く**

`apps/server/src/services/invitation-service.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { invitations } from '../db/schema';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb, testConfig } from '../test/helpers';
import { acceptInvitation, createInvitation } from './invitation-service';
import { getSessionUser } from './session-service';

describe('invitation service', () => {
  const ctx = createTestApp();
  const config = testConfig();
  beforeEach(async () => {
    await resetDb(ctx.db);
    ctx.mailer.sent.length = 0;
  });
  afterAll(() => ctx.pool.end());

  function tokenFromMail(): string {
    const m = ctx.mailer.sent[0].text.match(/\/invite\/([A-Za-z0-9_-]+)/);
    if (!m) throw new Error('invite link not found in mail');
    return m[1];
  }

  it('招待メールを送り、トークンはハッシュで保存される', async () => {
    await createInvitation(ctx.db, ctx.mailer, config, 'new@example.com');
    expect(ctx.mailer.sent[0].to).toBe('new@example.com');
    const token = tokenFromMail();
    const rows = await ctx.db.select().from(invitations);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
  });

  it('既存ユーザーのメールには EMAIL_TAKEN', async () => {
    const u = await createTestUser(ctx.db);
    await expect(createInvitation(ctx.db, ctx.mailer, config, u.email)).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
  });

  it('受諾でユーザーとセッションが作られる', async () => {
    await createInvitation(ctx.db, ctx.mailer, config, 'new@example.com');
    const { sid, user } = await acceptInvitation(ctx.db, tokenFromMail(), {
      displayName: '新人',
      password: 'long-enough-password',
    });
    expect(user.email).toBe('new@example.com');
    expect((await getSessionUser(ctx.db, sid))?.id).toBe(user.id);
  });

  it('同じトークンの再受諾は INVALID_TOKEN', async () => {
    await createInvitation(ctx.db, ctx.mailer, config, 'new@example.com');
    const token = tokenFromMail();
    await acceptInvitation(ctx.db, token, { displayName: 'A', password: 'long-enough-password' });
    await expect(
      acceptInvitation(ctx.db, token, { displayName: 'B', password: 'long-enough-password' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('期限切れトークンは INVALID_TOKEN', async () => {
    await createInvitation(ctx.db, ctx.mailer, config, 'new@example.com');
    await ctx.db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(
      acceptInvitation(ctx.db, tokenFromMail(), { displayName: 'A', password: 'long-enough-password' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('デタラメなトークンは INVALID_TOKEN', async () => {
    await expect(
      acceptInvitation(ctx.db, 'bogus-token', { displayName: 'A', password: 'long-enough-password' }),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/invitation-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 招待サービスを実装**

`apps/server/src/services/invitation-service.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import type { Config } from '../config';
import { invitations, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db, Mailer } from '../types';
import { hashPassword } from './password';
import { createSession, hashToken, toSessionUser } from './session-service';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvitation(
  db: Db,
  mailer: Mailer,
  config: Config,
  email: string,
): Promise<void> {
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    throw new AppError('EMAIL_TAKEN', 'このメールアドレスは既に登録されています', 409);
  }
  const token = randomBytes(32).toString('base64url');
  await db.insert(invitations).values({
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
  });
  await mailer.send(
    email,
    '【knowledge-hub】アカウント登録のご招待',
    `knowledge-hub に招待されました。以下のリンクからアカウントを登録してください（7日間有効）:\n\n${config.appUrl}/invite/${token}`,
  );
}

export async function acceptInvitation(
  db: Db,
  token: string,
  input: { displayName: string; password: string },
): Promise<{ sid: string; user: SessionUser }> {
  const inv = await db.query.invitations.findFirst({
    where: eq(invitations.tokenHash, hashToken(token)),
  });
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) {
    throw new AppError('INVALID_TOKEN', '招待リンクが無効か、期限切れです', 400);
  }
  const [user] = await db
    .insert(users)
    .values({
      email: inv.email,
      displayName: input.displayName,
      authProvider: 'password',
      passwordHash: await hashPassword(input.password),
    })
    .returning();
  await db.update(invitations).set({ usedAt: new Date() }).where(eq(invitations.id, inv.id));
  const sid = await createSession(db, user.id);
  return { sid, user: toSessionUser(user) };
}
```

Run: `pnpm --filter @knowledge-hub/server test src/services/invitation-service.test.ts`
Expected: PASS（6 件）

- [ ] **Step 4: 受諾エンドポイントを追加**

`apps/server/src/routes/auth.ts` のチェーン末尾（`.get('/me', ...)` の後）に追加:
```ts
  .post(
    '/invitations/:token/accept',
    validate('json', acceptInvitationSchema),
    async (c) => {
      const { sid, user } = await acceptInvitation(
        c.get('db'),
        c.req.param('token'),
        c.req.valid('json'),
      );
      setSessionCookie(c, sid, c.get('config'));
      return c.json(user);
    },
  )
```

import 追加: `import { acceptInvitationSchema } from '@knowledge-hub/shared';` / `import { acceptInvitation } from '../services/invitation-service';`

`apps/server/src/routes/auth.test.ts` にケース追記:
```ts
  it('招待受諾エンドポイントでユーザー登録できる', async () => {
    const { createInvitation } = await import('../services/invitation-service');
    const { testConfig } = await import('../test/helpers');
    await createInvitation(ctx.db, ctx.mailer, testConfig(), 'new@example.com');
    const token = ctx.mailer.sent[0].text.match(/\/invite\/([A-Za-z0-9_-]+)/)![1];
    const res = await ctx.app.request(`/api/auth/invitations/${token}/accept`, json({
      displayName: '新人',
      password: 'long-enough-password',
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe('new@example.com');
    expect(res.headers.get('set-cookie')).toContain('sid=');
  });
```

- [ ] **Step 5: 全テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test`
Expected: 全 PASS（実 SMTP 経由の配信は Task 14 Step 3 の手動 E2E で Mailpit にて検証する）

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add smtp mailer and invitation flow"
```

---

### Task 11: パスワードリセットとアカウント設定 API

**Files:**
- Create: `apps/server/src/services/{password-reset-service.ts,user-service.ts}`, `apps/server/src/routes/users.ts`
- Modify: `apps/server/src/routes/auth.ts`（reset request/confirm 追加）, `apps/server/src/app.ts`（`.route('/api/users', userRoutes)` 追加）
- Test: `apps/server/src/services/password-reset-service.test.ts`, `apps/server/src/services/user-service.test.ts`, `apps/server/src/routes/users.test.ts`

**Interfaces:**
- Produces:
  - `requestPasswordReset(db, mailer, config, email): Promise<void>`（対象がいなくても正常終了 = メール列挙攻撃対策。リンク `${config.appUrl}/password-reset/<token>`、有効 1 時間）
  - `resetPassword(db, token, newPassword): Promise<void>`（INVALID_TOKEN / 成功時は全セッション失効）
  - `updateProfile(db, userId, { displayName, bio }): Promise<SessionUser>`
  - `changePassword(db, userId, currentPassword, newPassword): Promise<void>`（現パスワード不一致は AppError INVALID_CREDENTIALS 400。成功時は全セッション失効）
  - HTTP: `POST /api/auth/password-reset/request` → 204（常に）、`POST /api/auth/password-reset/confirm/:token` → 204、`PATCH /api/users/me` → 200 SessionUser、`POST /api/users/me/password` → 204 + 新セッション Cookie
- Consumes: Task 7/10 のサービス群

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/services/password-reset-service.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser } from '../test/factories';
import { createTestApp, resetDb, testConfig } from '../test/helpers';
import { loginWithPassword } from './auth-service';
import { requestPasswordReset, resetPassword } from './password-reset-service';
import { createSession, getSessionUser } from './session-service';

describe('password reset', () => {
  const ctx = createTestApp();
  const config = testConfig();
  beforeEach(async () => {
    await resetDb(ctx.db);
    ctx.mailer.sent.length = 0;
  });
  afterAll(() => ctx.pool.end());

  function tokenFromMail(): string {
    const m = ctx.mailer.sent[0].text.match(/\/password-reset\/([A-Za-z0-9_-]+)/);
    if (!m) throw new Error('reset link not found');
    return m[1];
  }

  it('登録ユーザーにはリセットメールが飛ぶ', async () => {
    const u = await createTestUser(ctx.db);
    await requestPasswordReset(ctx.db, ctx.mailer, config, u.email);
    expect(ctx.mailer.sent).toHaveLength(1);
  });

  it('未登録メールでもエラーにせずメールも送らない', async () => {
    await requestPasswordReset(ctx.db, ctx.mailer, config, 'nobody@example.com');
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('リセット後は新パスワードでログインでき、既存セッションは失効する', async () => {
    const u = await createTestUser(ctx.db, { email: 'a@example.com' });
    const oldSid = await createSession(ctx.db, u.id);
    await requestPasswordReset(ctx.db, ctx.mailer, config, 'a@example.com');
    await resetPassword(ctx.db, tokenFromMail(), 'brand-new-password');
    expect(await loginWithPassword(ctx.db, 'a@example.com', 'brand-new-password')).not.toBeNull();
    expect(await getSessionUser(ctx.db, oldSid)).toBeNull();
  });

  it('使用済みトークンは INVALID_TOKEN', async () => {
    const u = await createTestUser(ctx.db);
    await requestPasswordReset(ctx.db, ctx.mailer, config, u.email);
    const token = tokenFromMail();
    await resetPassword(ctx.db, token, 'brand-new-password');
    await expect(resetPassword(ctx.db, token, 'another-password-x')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });
});
```

`apps/server/src/services/user-service.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';
import { createSession, getSessionUser } from './session-service';
import { changePassword, updateProfile } from './user-service';

describe('user service', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('プロフィールを更新できる', async () => {
    const u = await createTestUser(ctx.db);
    const updated = await updateProfile(ctx.db, u.id, { displayName: '花子', bio: 'インフラ担当' });
    expect(updated.displayName).toBe('花子');
    expect(updated.bio).toBe('インフラ担当');
  });

  it('changePassword は現パスワード不一致で INVALID_CREDENTIALS', async () => {
    const u = await createTestUser(ctx.db);
    await expect(
      changePassword(ctx.db, u.id, 'wrong-current-pw', 'new-password-long'),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('changePassword 成功で既存セッションが失効する', async () => {
    const u = await createTestUser(ctx.db);
    const sid = await createSession(ctx.db, u.id);
    await changePassword(ctx.db, u.id, TEST_PASSWORD, 'new-password-long');
    expect(await getSessionUser(ctx.db, sid)).toBeNull();
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/services/password-reset-service.test.ts src/services/user-service.test.ts`
Expected: FAIL

- [ ] **Step 2: サービスを実装**

`apps/server/src/services/password-reset-service.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Config } from '../config';
import { passwordResetTokens, users } from '../db/schema';
import { AppError } from '../errors';
import type { Db, Mailer } from '../types';
import { hashPassword } from './password';
import { deleteUserSessions, hashToken } from './session-service';

const RESET_TTL_MS = 60 * 60 * 1000;

export async function requestPasswordReset(
  db: Db,
  mailer: Mailer,
  config: Config,
  email: string,
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: and(eq(users.email, email), eq(users.isActive, true), eq(users.authProvider, 'password')),
  });
  if (!user) return; // メール列挙攻撃対策: 存在有無を応答に出さない
  const token = randomBytes(32).toString('base64url');
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  await mailer.send(
    email,
    '【knowledge-hub】パスワード再設定',
    `以下のリンクからパスワードを再設定してください（1時間有効）:\n\n${config.appUrl}/password-reset/${token}`,
  );
}

export async function resetPassword(db: Db, token: string, newPassword: string): Promise<void> {
  const row = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, hashToken(token)),
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    throw new AppError('INVALID_TOKEN', 'リンクが無効か、期限切れです', 400);
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, row.userId));
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, row.id));
  await deleteUserSessions(db, row.userId);
}
```

`apps/server/src/services/user-service.ts`:
```ts
import { eq } from 'drizzle-orm';
import type { SessionUser } from '@knowledge-hub/shared';
import { users } from '../db/schema';
import { AppError } from '../errors';
import type { Db } from '../types';
import { hashPassword, verifyPassword } from './password';
import { deleteUserSessions, toSessionUser } from './session-service';

export async function updateProfile(
  db: Db,
  userId: string,
  input: { displayName: string; bio: string },
): Promise<SessionUser> {
  const [row] = await db.update(users).set(input).where(eq(users.id, userId)).returning();
  return toSessionUser(row);
}

export async function changePassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError('INVALID_CREDENTIALS', '現在のパスワードが正しくありません', 400);
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId));
  await deleteUserSessions(db, userId);
}
```

Run: `pnpm --filter @knowledge-hub/server test src/services`
Expected: PASS

- [ ] **Step 3: ルートを追加し統合テストを書く**

`apps/server/src/routes/auth.ts` のチェーン末尾に追加（import も対応）:
```ts
  .post('/password-reset/request', validate('json', passwordResetRequestSchema), async (c) => {
    await requestPasswordReset(c.get('db'), c.get('mailer'), c.get('config'), c.req.valid('json').email);
    return c.body(null, 204);
  })
  .post('/password-reset/confirm/:token', validate('json', passwordResetConfirmSchema), async (c) => {
    await resetPassword(c.get('db'), c.req.param('token'), c.req.valid('json').password);
    return c.body(null, 204);
  })
```

`apps/server/src/routes/users.ts`:
```ts
import { Hono } from 'hono';
import { changePasswordSchema, updateProfileSchema } from '@knowledge-hub/shared';
import { requireAuth, setSessionCookie } from '../middleware/session';
import { validate } from '../middleware/validate';
import { createSession } from '../services/session-service';
import { changePassword, updateProfile } from '../services/user-service';
import type { AppEnv } from '../types';

export const userRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .patch('/me', validate('json', updateProfileSchema), async (c) => {
    const updated = await updateProfile(c.get('db'), c.get('user').id, c.req.valid('json'));
    return c.json(updated);
  })
  .post('/me/password', validate('json', changePasswordSchema), async (c) => {
    const { currentPassword, newPassword } = c.req.valid('json');
    const userId = c.get('user').id;
    await changePassword(c.get('db'), userId, currentPassword, newPassword);
    const sid = await createSession(c.get('db'), userId);
    setSessionCookie(c, sid, c.get('config'));
    return c.body(null, 204);
  });
```

`apps/server/src/app.ts` に `.route('/api/users', userRoutes)` を追加。

`apps/server/src/routes/users.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('user routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function loginCookie(email: string): Promise<string> {
    await createTestUser(ctx.db, { email });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }

  it('PATCH /api/users/me でプロフィール更新できる', async () => {
    const cookie = await loginCookie('a@example.com');
    const res = await ctx.app.request('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: '花子', bio: 'SRE' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe('花子');
  });

  it('パスワード変更後、旧 Cookie は無効で新 Cookie が発行される', async () => {
    const cookie = await loginCookie('a@example.com');
    const res = await ctx.app.request('/api/users/me/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: 'new-password-long' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(204);
    const newCookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    expect((await ctx.app.request('/api/auth/me', { headers: { cookie } })).status).toBe(401);
    expect((await ctx.app.request('/api/auth/me', { headers: { cookie: newCookie } })).status).toBe(200);
  });
});
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter @knowledge-hub/server test`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add password reset and account settings endpoints"
```

---

### Task 12: 管理 API・seed スクリプト・起動エントリ

**Files:**
- Create: `apps/server/src/routes/admin.ts`, `apps/server/src/scripts/seed-admin.ts`, `apps/server/src/index.ts`, `apps/server/.env`（.env.example からコピー、git 管理外）
- Modify: `apps/server/src/services/user-service.ts`（listUsers / updateUserByAdmin 追加）, `apps/server/src/app.ts`（`.route('/api/admin', adminRoutes)`）
- Test: `apps/server/src/routes/admin.test.ts`

**Interfaces:**
- Produces:
  - `listUsers(db): Promise<AdminUserView[]>` — `AdminUserView = { id, email, displayName, role, authProvider, isActive, createdAt }`（user-service.ts から export）
  - `updateUserByAdmin(db, targetId, patch: { role?; isActive? }): Promise<AdminUserView>` — 最後の active な admin を降格/無効化しようとしたら AppError LAST_ADMIN 409。無効化時は deleteUserSessions。対象不在は NOT_FOUND 404
  - HTTP: `GET /api/admin/users` → 200 AdminUserView[]、`POST /api/admin/users/invitations` → 204、`PATCH /api/admin/users/:id` → 200 AdminUserView（すべて requireAuth + requireAdmin）
  - `pnpm --filter @knowledge-hub/server seed:admin` — ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME から初期 admin 作成（既存ならスキップ）
- Consumes: Task 9 の requireAdmin、Task 10 の createInvitation

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/routes/admin.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('admin routes', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  async function login(email: string, role: 'member' | 'admin' = 'admin'): Promise<string> {
    await createTestUser(ctx.db, { email, role });
    const res = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  }

  it('member は 403', async () => {
    const cookie = await login('m@example.com', 'member');
    expect((await ctx.app.request('/api/admin/users', { headers: { cookie } })).status).toBe(403);
  });

  it('admin はユーザー一覧を取得できる', async () => {
    const cookie = await login('a@example.com');
    await createTestUser(ctx.db, { email: 'b@example.com' });
    const res = await ctx.app.request('/api/admin/users', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).length).toBe(2);
  });

  it('admin は招待を送れる', async () => {
    const cookie = await login('a@example.com');
    const res = await ctx.app.request('/api/admin/users/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'new@example.com' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(204);
    expect(ctx.mailer.sent.at(-1)?.to).toBe('new@example.com');
  });

  it('無効化するとそのユーザーのセッションが切れる', async () => {
    const adminCookie = await login('a@example.com');
    const targetCookie = await login('b@example.com', 'member');
    const target = (await (await ctx.app.request('/api/admin/users', { headers: { cookie: adminCookie } })).json())
      .find((u: { email: string }) => u.email === 'b@example.com');
    const res = await ctx.app.request(`/api/admin/users/${target.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false }),
      headers: { 'content-type': 'application/json', cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    expect((await ctx.app.request('/api/auth/me', { headers: { cookie: targetCookie } })).status).toBe(401);
  });

  it('最後の admin の降格は LAST_ADMIN', async () => {
    const cookie = await login('a@example.com');
    const me = await (await ctx.app.request('/api/auth/me', { headers: { cookie } })).json();
    const res = await ctx.app.request(`/api/admin/users/${me.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'member' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('LAST_ADMIN');
  });

  it('admin が 2 人いれば降格できる', async () => {
    const cookie = await login('a@example.com');
    const other = await createTestUser(ctx.db, { email: 'a2@example.com', role: 'admin' });
    const res = await ctx.app.request(`/api/admin/users/${other.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'member' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe('member');
  });
});
```

Run: `pnpm --filter @knowledge-hub/server test src/routes/admin.test.ts`
Expected: FAIL

- [ ] **Step 2: user-service 拡張と admin ルートを実装**

`apps/server/src/services/user-service.ts` に追加:
```ts
import { and, count } from 'drizzle-orm'; // 既存 import に追記

export type AdminUserView = {
  id: string;
  email: string;
  displayName: string;
  role: 'member' | 'admin';
  authProvider: 'oidc' | 'password';
  isActive: boolean;
  createdAt: Date;
};

function toAdminView(row: typeof users.$inferSelect): AdminUserView {
  const { id, email, displayName, role, authProvider, isActive, createdAt } = row;
  return { id, email, displayName, role, authProvider, isActive, createdAt };
}

export async function listUsers(db: Db): Promise<AdminUserView[]> {
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return rows.map(toAdminView);
}

export async function updateUserByAdmin(
  db: Db,
  targetId: string,
  patch: { role?: 'member' | 'admin'; isActive?: boolean },
): Promise<AdminUserView> {
  const target = await db.query.users.findFirst({ where: eq(users.id, targetId) });
  if (!target) throw new AppError('NOT_FOUND', 'ユーザーが見つかりません', 404);

  const demoting = target.role === 'admin' && (patch.role === 'member' || patch.isActive === false);
  if (demoting) {
    const [{ value: activeAdmins }] = await db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
    if (activeAdmins <= 1) {
      throw new AppError('LAST_ADMIN', '最後の管理者は降格・無効化できません', 409);
    }
  }

  const [row] = await db.update(users).set(patch).where(eq(users.id, targetId)).returning();
  if (patch.isActive === false) await deleteUserSessions(db, targetId);
  return toAdminView(row);
}
```

`apps/server/src/routes/admin.ts`:
```ts
import { Hono } from 'hono';
import { inviteSchema, updateUserByAdminSchema } from '@knowledge-hub/shared';
import { requireAdmin } from '../middleware/admin';
import { requireAuth } from '../middleware/session';
import { validate } from '../middleware/validate';
import { createInvitation } from '../services/invitation-service';
import { listUsers, updateUserByAdmin } from '../services/user-service';
import type { AppEnv } from '../types';

export const adminRoutes = new Hono<AppEnv>()
  .use(requireAuth, requireAdmin)
  .get('/users', async (c) => c.json(await listUsers(c.get('db'))))
  .post('/users/invitations', validate('json', inviteSchema), async (c) => {
    await createInvitation(c.get('db'), c.get('mailer'), c.get('config'), c.req.valid('json').email);
    return c.body(null, 204);
  })
  .patch('/users/:id', validate('json', updateUserByAdminSchema), async (c) => {
    const updated = await updateUserByAdmin(c.get('db'), c.req.param('id'), c.req.valid('json'));
    return c.json(updated);
  });
```

`apps/server/src/app.ts` に `.route('/api/admin', adminRoutes)` を追加。

Run: `pnpm --filter @knowledge-hub/server test`
Expected: 全 PASS

- [ ] **Step 3: seed スクリプトと起動エントリ**

`apps/server/src/scripts/seed-admin.ts`:
```ts
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config';
import { createDb } from '../db/client';
import { users } from '../db/schema';
import { hashPassword } from '../services/password';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const displayName = process.env.ADMIN_NAME ?? '管理者';

if (!email || !password) {
  console.error('ADMIN_EMAIL と ADMIN_PASSWORD を環境変数で指定してください');
  process.exit(1);
}
if (password.length < 12) {
  console.error('ADMIN_PASSWORD は 12 文字以上にしてください');
  process.exit(1);
}

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);

const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
if (existing) {
  console.log(`既に存在します: ${email}`);
} else {
  await db.insert(users).values({
    email,
    displayName,
    role: 'admin',
    authProvider: 'password',
    passwordHash: await hashPassword(password),
  });
  console.log(`admin を作成しました: ${email}`);
}
await pool.end();
```

`apps/server/src/index.ts`:
```ts
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { logger } from './logger';
import { createSmtpMailer } from './services/mailer';

const config = loadConfig();
const { db } = createDb(config.databaseUrl);
const app = buildApp({ db, config, mailer: createSmtpMailer(config) });

// 本番: ビルド済み SPA を配信（開発時は Vite dev server が担当するため 404 になるだけで無害）
app.use('*', serveStatic({ root: '../web/dist' }));
app.get('*', serveStatic({ path: '../web/dist/index.html' }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(`knowledge-hub server listening on :${info.port}`);
});
```

- [ ] **Step 4: 起動 smoke テスト**

Run:
```bash
docker compose up -d
cp .env.example apps/server/.env
pnpm --filter @knowledge-hub/server db:migrate
pnpm --filter @knowledge-hub/server seed:admin
pnpm --filter @knowledge-hub/server dev &
sleep 3 && curl -s localhost:3000/healthz
curl -s -X POST localhost:3000/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me-please-12"}'
kill %1
```
Expected: healthz が `{"status":"ok"}`、login が SessionUser の JSON を返す

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add admin user management, seed script and server entry"
```

---

### Task 13: Web スケルトン（ログイン + 認証ガード）

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/{main.tsx,App.tsx,styles.css}`, `apps/web/src/api/client.ts`, `apps/web/src/auth/{useMe.ts,RequireAuth.tsx}`, `apps/web/src/components/Layout.tsx`, `apps/web/src/pages/{LoginPage.tsx,HomePage.tsx}`, `apps/web/src/test/setup.ts`
- Test: `apps/web/src/pages/LoginPage.test.tsx`

**Interfaces:**
- Produces: `api`（`hc<AppType>` 型付きクライアント。以降の UI はすべてこれ経由）、`useMe()`（`SessionUser | null | undefined`）、`RequireAuth`、`Layout`（ヘッダー + Outlet）
- Consumes: server の `AppType`（`@knowledge-hub/server/app` から型のみ import）

- [ ] **Step 1: パッケージと設定**

`apps/web/package.json`:
```json
{
  "name": "@knowledge-hub/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@knowledge-hub/shared": "workspace:*",
    "@tanstack/react-query": "^5.64.1",
    "hono": "^4.6.16",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.1.1"
  },
  "devDependencies": {
    "@knowledge-hub/server": "workspace:*",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.4",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.7",
    "vitest": "^3.0.4"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client"] },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>knowledge-hub</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 2: 失敗するテストを書く**

`apps/web/src/pages/LoginPage.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const postMock = vi.fn();
vi.mock('../api/client', () => ({
  api: { api: { auth: { login: { $post: (...a: unknown[]) => postMock(...a) } } } },
}));

import { LoginPage } from './LoginPage';

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  it('入力値で login API を呼ぶ', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderPage();
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('パスワード'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(postMock).toHaveBeenCalledWith({
      json: { email: 'a@example.com', password: 'my-password-123' },
    });
  });

  it('失敗時にエラーメッセージを表示する', async () => {
    postMock.mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'INVALID_CREDENTIALS', message: 'メールアドレスまたはパスワードが正しくありません' }),
    });
    renderPage();
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'a@example.com');
    await userEvent.type(screen.getByLabelText('パスワード'), 'wrong-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('正しくありません');
  });
});
```

Run: `pnpm install && pnpm --filter @knowledge-hub/web test`
Expected: FAIL（LoginPage 未作成）

- [ ] **Step 3: 実装**

`apps/web/src/api/client.ts`:
```ts
import { hc } from 'hono/client';
import type { AppType } from '@knowledge-hub/server/app';

export const api = hc<AppType>('/');
```

`apps/web/src/auth/useMe.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await api.api.auth.me.$get();
      if (res.status === 401) return null;
      if (!res.ok) throw new Error('failed to fetch me');
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });
}
```

`apps/web/src/auth/RequireAuth.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMe } from './useMe';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <p className="loading">読み込み中…</p>;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

`apps/web/src/pages/LoginPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await api.api.auth.login.$post({ json: { email, password } });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? 'ログインに失敗しました');
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/');
  }

  return (
    <main className="auth-page">
      <form onSubmit={onSubmit} className="auth-form">
        <h1>knowledge-hub</h1>
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          パスワード
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit">ログイン</button>
        <Link to="/password-reset">パスワードをお忘れですか？</Link>
      </form>
    </main>
  );
}
```

`apps/web/src/pages/HomePage.tsx`:
```tsx
export function HomePage() {
  return (
    <section>
      <h2>ホーム</h2>
      <p>記事フィードはフェーズ2以降で実装されます。</p>
    </section>
  );
}
```

`apps/web/src/components/Layout.tsx`:
```tsx
import { Link, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useMe } from '../auth/useMe';

export function Layout() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function onLogout() {
    await api.api.auth.logout.$post();
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/login');
  }

  return (
    <div className="layout">
      <header className="header">
        <Link to="/" className="brand">knowledge-hub</Link>
        <nav>
          {me?.role === 'admin' && <Link to="/admin">管理</Link>}
          <Link to="/settings">設定</Link>
          <span className="me">{me?.displayName}</span>
          <button type="button" onClick={onLogout}>ログアウト</button>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
```

`apps/web/src/App.tsx`:
```tsx
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './auth/RequireAuth';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [{ path: '/', element: <HomePage /> }],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
```

`apps/web/src/main.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

`apps/web/src/styles.css`（最小限。ビジュアルデザインはフェーズ4で作り込む）:
```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1f2328; }
.header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.5rem; border-bottom: 1px solid #d0d7de; }
.header nav { display: flex; gap: 1rem; align-items: center; }
.brand { font-weight: 700; text-decoration: none; color: inherit; }
.content { max-width: 960px; margin: 0 auto; padding: 1.5rem; }
.auth-page { display: grid; place-items: center; min-height: 100vh; }
.auth-form { display: flex; flex-direction: column; gap: 1rem; width: min(360px, 90vw); }
.auth-form label { display: flex; flex-direction: column; gap: 0.25rem; }
.auth-form input { padding: 0.5rem; border: 1px solid #d0d7de; border-radius: 6px; }
.form-error { color: #d1242f; margin: 0; }
button { padding: 0.5rem 1rem; border: none; border-radius: 6px; background: #1f6feb; color: #fff; cursor: pointer; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #d0d7de; }
```

- [ ] **Step 4: テスト + 手動確認**

Run: `pnpm --filter @knowledge-hub/web test && pnpm --filter @knowledge-hub/web typecheck`
Expected: PASS（2 件）

手動: `pnpm --filter @knowledge-hub/server dev` と `pnpm --filter @knowledge-hub/web dev` を並行起動し、http://localhost:5173 で seed した admin でログイン → ホーム表示 → ログアウトを確認

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add web spa skeleton with login and auth guard"
```

---

### Task 14: 招待・リセット・設定・管理画面 UI

**Files:**
- Create: `apps/web/src/pages/{InvitePage.tsx,PasswordResetRequestPage.tsx,PasswordResetConfirmPage.tsx,SettingsPage.tsx,AdminUsersPage.tsx}`
- Modify: `apps/web/src/App.tsx`（ルート追加）
- Test: `apps/web/src/pages/AdminUsersPage.test.tsx`

**Interfaces:**
- Consumes: Task 10-12 の HTTP API（招待受諾 / リセット / プロフィール / 管理）、Task 13 の `api` / `Layout` / `RequireAuth`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/pages/AdminUsersPage.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    api: {
      admin: {
        users: {
          $get: vi.fn().mockResolvedValue({
            ok: true,
            json: async () => [
              { id: '1', email: 'a@example.com', displayName: '管理者', role: 'admin', authProvider: 'password', isActive: true, createdAt: '2026-07-04T00:00:00Z' },
              { id: '2', email: 'b@example.com', displayName: '太郎', role: 'member', authProvider: 'password', isActive: false, createdAt: '2026-07-04T00:00:00Z' },
            ],
          }),
          invitations: { $post: vi.fn() },
          ':id': { $patch: vi.fn() },
        },
      },
    },
  },
}));

import { AdminUsersPage } from './AdminUsersPage';

describe('AdminUsersPage', () => {
  it('ユーザー一覧を表示し、無効ユーザーにはラベルが付く', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AdminUsersPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('a@example.com')).toBeInTheDocument();
    expect(await screen.findByText('無効')).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @knowledge-hub/web test src/pages/AdminUsersPage.test.tsx`
Expected: FAIL

- [ ] **Step 2: ページを実装**

`apps/web/src/pages/InvitePage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await api.api.auth.invitations[':token'].accept.$post({
      param: { token: token ?? '' },
      json: { displayName, password },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? '登録に失敗しました');
      return;
    }
    navigate('/');
  }

  return (
    <main className="auth-page">
      <form onSubmit={onSubmit} className="auth-form">
        <h1>アカウント登録</h1>
        <label>
          表示名
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={50} />
        </label>
        <label>
          パスワード（12文字以上）
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit">登録する</button>
      </form>
    </main>
  );
}
```

`apps/web/src/pages/PasswordResetRequestPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { api } from '../api/client';

export function PasswordResetRequestPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await api.api.auth['password-reset'].request.$post({ json: { email } });
    setDone(true);
  }

  if (done) {
    return (
      <main className="auth-page">
        <p>登録されているメールアドレスであれば、再設定用のリンクを送信しました。メールをご確認ください。</p>
      </main>
    );
  }
  return (
    <main className="auth-page">
      <form onSubmit={onSubmit} className="auth-form">
        <h1>パスワード再設定</h1>
        <label>
          メールアドレス
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button type="submit">再設定リンクを送る</button>
      </form>
    </main>
  );
}
```

`apps/web/src/pages/PasswordResetConfirmPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api/client';

export function PasswordResetConfirmPage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await api.api.auth['password-reset'].confirm[':token'].$post({
      param: { token: token ?? '' },
      json: { password },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? '再設定に失敗しました');
      return;
    }
    navigate('/login');
  }

  return (
    <main className="auth-page">
      <form onSubmit={onSubmit} className="auth-form">
        <h1>新しいパスワード</h1>
        <label>
          パスワード（12文字以上）
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit">パスワードを設定</button>
      </form>
    </main>
  );
}
```

`apps/web/src/pages/SettingsPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useMe } from '../auth/useMe';

export function SettingsPage() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    const res = await api.api.users.me.$patch({ json: { displayName, bio } });
    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      setProfileMsg('保存しました');
    } else {
      setProfileMsg('保存に失敗しました');
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    const res = await api.api.users.me.password.$post({ json: { currentPassword, newPassword } });
    if (res.ok) {
      setPasswordMsg('パスワードを変更しました');
      setCurrentPassword('');
      setNewPassword('');
    } else {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setPasswordMsg(body?.message ?? '変更に失敗しました');
    }
  }

  return (
    <section>
      <h2>アカウント設定</h2>
      <form onSubmit={onSaveProfile} className="auth-form">
        <h3>プロフィール</h3>
        <label>
          表示名
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={50} />
        </label>
        <label>
          自己紹介
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} maxLength={2000} />
        </label>
        {profileMsg && <p role="status">{profileMsg}</p>}
        <button type="submit">保存</button>
      </form>
      <form onSubmit={onChangePassword} className="auth-form">
        <h3>パスワード変更</h3>
        <label>
          現在のパスワード
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </label>
        <label>
          新しいパスワード（12文字以上）
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={12} />
        </label>
        {passwordMsg && <p role="status">{passwordMsg}</p>}
        <button type="submit">変更する</button>
      </form>
    </section>
  );
}
```

`apps/web/src/pages/AdminUsersPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const { data: users } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await api.api.admin.users.$get();
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
  });

  const patchUser = useMutation({
    mutationFn: async (input: { id: string; role?: 'member' | 'admin'; isActive?: boolean }) => {
      const { id, ...json } = input;
      const res = await api.api.admin.users[':id'].$patch({ param: { id }, json });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? '更新に失敗しました');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e) => alert(e.message),
  });

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setInviteMsg(null);
    const res = await api.api.admin.users.invitations.$post({ json: { email: inviteEmail } });
    if (res.ok) {
      setInviteMsg(`${inviteEmail} に招待を送りました`);
      setInviteEmail('');
    } else {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setInviteMsg(body?.message ?? '招待に失敗しました');
    }
  }

  return (
    <section>
      <h2>ユーザー管理</h2>
      <form onSubmit={onInvite} className="auth-form">
        <label>
          招待するメールアドレス
          <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
        </label>
        {inviteMsg && <p role="status">{inviteMsg}</p>}
        <button type="submit">招待を送る</button>
      </form>
      <table>
        <thead>
          <tr><th>メール</th><th>表示名</th><th>ロール</th><th>状態</th><th>操作</th></tr>
        </thead>
        <tbody>
          {(users ?? []).map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.displayName}</td>
              <td>{u.role === 'admin' ? '管理者' : 'メンバー'}</td>
              <td>{u.isActive ? '有効' : '無効'}</td>
              <td>
                <button type="button" onClick={() => patchUser.mutate({ id: u.id, role: u.role === 'admin' ? 'member' : 'admin' })}>
                  {u.role === 'admin' ? 'メンバーにする' : '管理者にする'}
                </button>{' '}
                <button type="button" onClick={() => patchUser.mutate({ id: u.id, isActive: !u.isActive })}>
                  {u.isActive ? '無効化' : '有効化'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

`apps/web/src/App.tsx` のルート定義を更新:
```tsx
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './auth/RequireAuth';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { HomePage } from './pages/HomePage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { PasswordResetConfirmPage } from './pages/PasswordResetConfirmPage';
import { PasswordResetRequestPage } from './pages/PasswordResetRequestPage';
import { SettingsPage } from './pages/SettingsPage';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/invite/:token', element: <InvitePage /> },
  { path: '/password-reset', element: <PasswordResetRequestPage /> },
  { path: '/password-reset/:token', element: <PasswordResetConfirmPage /> },
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/admin', element: <AdminUsersPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 3: テスト + 全体確認**

Run: `pnpm --filter @knowledge-hub/web test && pnpm typecheck && pnpm test`
Expected: 全 PASS

手動 E2E（フェーズ1の受け入れ確認）:
1. `docker compose up -d` + server/web dev 起動
2. admin でログイン → `/admin` で別メールを招待
3. http://localhost:8025 （Mailpit）で招待メールのリンクを開き、表示名 + パスワードで登録 → 自動ログインされる
4. `/settings` で表示名変更・パスワード変更（変更後も操作を継続できる）
5. ログアウト → 「パスワードをお忘れですか？」からリセット → Mailpit のリンクで新パスワード設定 → 再ログイン
6. admin で対象ユーザーを無効化 → そのユーザーのセッションが切れることを確認

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add invite, reset, settings and admin ui pages"
```

---

## フェーズ1完了の定義

- `pnpm test`（shared / server / web）が全て通る
- 手動 E2E（Task 14 Step 3）の 6 項目が通る
- 次フェーズ（記事・エディタ）の計画は、このフェーズ完了後に実コードを踏まえて作成する
