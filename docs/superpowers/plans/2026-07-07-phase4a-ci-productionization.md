# Phase 4a: CI + 本番化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移植可能な CI 安全網を敷き、本番運用に必要なセキュリティヘッダ・構造化ロギングを整え、正確性・堅牢性のバックログ Minor（不正カーソル 500・通知の非原子性）を一掃する。

**Architecture:** CI の実体はルート `package.json` の `verify` スクリプト（プラットフォーム非依存、ローカルでも動く）に集約し、GitHub Actions はそれを呼ぶだけの薄いアダプタにする（GitLab 等へ移行時は同じ `verify` を呼ぶ薄い yaml を書くだけ）。セキュリティヘッダ・リクエストロギングは Hono ミドルウェアとして buildApp に配線。カーソル復号は 5 サービス共通ユーティリティに集約し不正入力を 400 に統一。通知生成は best-effort（失敗しても中核操作を巻き込まない）に変更。

**Tech Stack:** Hono + Drizzle + PostgreSQL（Testcontainers postgres:16-alpine、pg_bigm なし）、pino、Vitest、pnpm 10 workspaces、Node 22、GitHub Actions。

## Global Constraints

- **CI エントリポイントは `pnpm run verify`**（ルート `package.json` のスクリプト）。`pnpm ci` は使わない — pnpm 10 には組み込みの `ci`（lockfile クリーンインストール）があり、スクリプト名 `ci` はシャドウされる。
- **GitHub Actions は薄いアダプタ**: checkout → pnpm/node セットアップ → `pnpm install --frozen-lockfile` → `pnpm run verify` のみ。CI ロジックの実体はワークフローに書かない。
- **依存脆弱性チェック（§11）**: `pnpm audit --audit-level=high`（high/critical で非ゼロ終了）を `verify` に含める。
- **CSP は実用的方針（2026-07-07 決定）**。CSP 文字列（verbatim）: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`。`img-src 'self' data:` は**外部画像をブロックする意図的な挙動変更**（§8「画像はアプリ配信 /api/uploads」と整合、トラッキングピクセル/IP 漏洩防止）。
- **セキュリティヘッダ一式**: 上記 CSP + `X-Content-Type-Options: nosniff`（既存を移設）+ `X-Frame-Options: DENY` + `Referrer-Policy: strict-origin-when-cross-origin` + `Permissions-Policy: camera=(), microphone=(), geolocation=()`。全レスポンスに付与（JSON に付いても無害）。
- **不正カーソルは 500 でなく 400**: `AppError('VALIDATION', '不正なカーソルです', 400)`。共有ユーティリティ `apps/server/src/services/cursor.ts` に集約し、5 サービス（search / article / comment / engagement / notification）すべてが import する。
- **通知は best-effort（M2 の決定）**: `try/catch` で囲み失敗は `logger.warn` で記録して回復。コメント/リアクション/公開の中核操作は常に成功する。**トランザクションでは囲まない。**
- **構造化ロギング（§13）**: pino のリクエストロギングミドルウェア（`requestId` / `method` / `path` / `status` / `durationMs`）。**リクエストボディはログに出さない**（パスワード等の漏洩防止）。
- **既存 API のレスポンス形状は変えない**（web の `hc<AppType>` 型推論を壊さない）。
- **テストは `LOG_LEVEL=silent`**（vitest の env で設定、ログ氾濫防止）。
- Node 22 / pnpm 10 / ESM。コミットは Conventional Commits（英語・subject 小文字開始）、1 タスク 1 コミット。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `apps/server/src/services/cursor.ts`（新規） | 共有カーソル encode/decode。不正入力は VALIDATION(400) |
| `apps/server/src/services/cursor.test.ts`（新規） | cursor ユニットテスト + 1 統合テスト（endpoint で 400） |
| `apps/server/src/services/{search,article,comment,engagement,notification}-service.ts`（変更） | ローカル encode/decode を削除し cursor.ts を import |
| `apps/server/src/services/notification-service.ts`（変更） | `runNotify(label, fn)` best-effort ヘルパー追加 |
| `apps/server/src/services/{comment,engagement,article}-service.ts`（変更） | 5 つの通知呼び出しを `runNotify` で包む |
| `apps/server/src/services/notification-best-effort.test.ts`（新規） | `runNotify` のユニットテスト（失敗を握り潰す） |
| `apps/server/src/middleware/security-headers.ts`（新規） | CSP + セキュリティヘッダ一式 |
| `apps/server/src/middleware/security-headers.test.ts`（新規） | ヘッダ存在の統合テスト |
| `apps/server/src/middleware/request-logger.ts`（新規） | pino リクエストロギング |
| `apps/server/src/middleware/request-logger.test.ts`（新規） | logger.info 呼び出しの検証 |
| `apps/server/src/app.ts`（変更） | 既存 nosniff を securityHeaders に置換 + requestLogger 配線 |
| `apps/server/src/index.ts`（変更） | 起動時 pg_bigm チェックを try/catch 化 |
| `apps/server/vitest.config.ts`（変更） | test.env に LOG_LEVEL=silent |
| `package.json`（ルート、変更） | `verify` スクリプト追加 |
| `.github/workflows/ci.yml`（新規） | 薄い GitHub Actions アダプタ |
| `README.md`（変更） | 「CI / 品質ゲート」節（可搬性の説明） |

**4a で触らないもの:** 各カーソルサービスの WHERE/ORDER BY ロジック（Task 1 は encode/decode の抽出のみ、ページングの意味論は不変）／通知生成関数本体（Task 2 は呼び出しを包むだけ）／既存ルート・スキーマ・web。

---

### Task 1: 共有カーソルユーティリティ + 不正カーソル 400（5 サービス）

**Files:**
- Create: `apps/server/src/services/cursor.ts`
- Create: `apps/server/src/services/cursor.test.ts`
- Modify: `apps/server/src/services/search-service.ts`（encode/decode 削除→import）
- Modify: `apps/server/src/services/article-service.ts`（同上）
- Modify: `apps/server/src/services/comment-service.ts`（同上）
- Modify: `apps/server/src/services/engagement-service.ts`（同上）
- Modify: `apps/server/src/services/notification-service.ts`（同上）

**Interfaces:**
- Consumes: `AppError` from `../errors`（`AppError('VALIDATION', msg, 400)`）。
- Produces（5 サービスが import）:
  - `encodeCursor(sortKey: Date | null, id: string): string`
  - `decodeCursor(cursor: string): { sortKey: string; id: string }` — 不正入力で `AppError('VALIDATION', '不正なカーソルです', 400)` を throw。

現状: 5 サービスがそれぞれ同一の `decodeCursor` を持ち、不正な base64url/`|` 欠落だと `new Date(sortKey)` が Invalid Date になり SQL に渡って 500 になる。共有化して 400 に統一する。

- [ ] **Step 1: cursor.ts の失敗するテストを書く**

`apps/server/src/services/cursor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { decodeCursor, encodeCursor } from './cursor';

const UUID = '47395b74-5d75-487d-9ee6-481eb4c32ebc';

describe('cursor encode/decode', () => {
  it('Date と id を round-trip できる', () => {
    const d = new Date('2026-07-07T01:02:03.456Z');
    const c = encodeCursor(d, UUID);
    expect(decodeCursor(c)).toEqual({ sortKey: '2026-07-07T01:02:03.456Z', id: UUID });
  });

  it('null sortKey（未公開 publishedAt）を空文字で round-trip できる', () => {
    const c = encodeCursor(null, UUID);
    expect(decodeCursor(c)).toEqual({ sortKey: '', id: UUID });
  });

  it('base64url 化け（| 欠落）は VALIDATION 400', () => {
    const bad = Buffer.from('no-separator-here').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
    try {
      decodeCursor(bad);
    } catch (e) {
      expect((e as AppError).status).toBe(400);
      expect((e as AppError).code).toBe('VALIDATION');
    }
  });

  it('id が UUID でないカーソルは VALIDATION 400', () => {
    const bad = Buffer.from('2026-07-07T00:00:00.000Z|not-a-uuid').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
  });

  it('sortKey が空でも ISO でもない場合は VALIDATION 400', () => {
    const bad = Buffer.from(`garbage-date|${UUID}`).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
  });

  it('まったくの非 base64 文字列も 400（例外は AppError に正規化）', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(AppError);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/server test -- cursor`
Expected: FAIL（cursor.ts が存在しない）

- [ ] **Step 3: cursor.ts を実装**

`apps/server/src/services/cursor.ts`:

```ts
import { z } from 'zod';
import { AppError } from '../errors';

// カーソルは `${ISO または空}|${行UUID}` を base64url した文字列。全リスト系サービスで共有。
// 空 sortKey は article/search の publishedAt が null の行に対応する。
export function encodeCursor(sortKey: Date | null, id: string): string {
  return Buffer.from(`${sortKey?.toISOString() ?? ''}|${id}`).toString('base64url');
}

const uuidSchema = z.string().uuid();

// 不正なカーソル（base64 化けで '|' 欠落 / id が UUID でない / sortKey が空でも ISO でもない）は
// DB エラー（500）ではなく VALIDATION(400) にする。Buffer.from(_, 'base64url') は寛容で throw しないため、
// 復号後の構造を明示的に検証する。
export function decodeCursor(cursor: string): { sortKey: string; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString();
  const sep = decoded.indexOf('|');
  if (sep === -1) throw new AppError('VALIDATION', '不正なカーソルです', 400);
  const sortKey = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!uuidSchema.safeParse(id).success) throw new AppError('VALIDATION', '不正なカーソルです', 400);
  if (sortKey !== '' && Number.isNaN(Date.parse(sortKey))) {
    throw new AppError('VALIDATION', '不正なカーソルです', 400);
  }
  return { sortKey, id };
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `pnpm --filter @knowledge-hub/server test -- cursor`
Expected: 6/6 PASS

- [ ] **Step 5: 5 サービスをローカル定義から共有 import に置換**

各ファイルで、ローカルの `function encodeCursor(...)` と `function decodeCursor(...)` の**両定義を削除**し、ファイル先頭の import 群に次を追加する:

```ts
import { decodeCursor, encodeCursor } from './cursor';
```

対象と現在の定義位置（削除するもの）:
- `apps/server/src/services/search-service.ts`（`decodeCursor` は 45 行付近、`encodeCursor` はその直前）
- `apps/server/src/services/article-service.ts`（`encodeCursor`/`decodeCursor` は 194-200 行付近）
- `apps/server/src/services/comment-service.ts`（37-43 行付近）
- `apps/server/src/services/engagement-service.ts`（86-92 行付近）
- `apps/server/src/services/notification-service.ts`（144 行付近の `decodeCursor` と対の `encodeCursor`）

注意: comment/engagement/notification のローカル `encodeCursor` は引数が `sortKey: Date`（非 null）だが、共有版は `Date | null` を受けるため呼び出し側（`Date` を渡す）はそのまま型互換。article/search は元々 `Date | null` なので一致。各サービスの呼び出し箇所（`encodeCursor(...)` / `decodeCursor(...)`）のシグネチャ・戻り値は不変なので本体ロジックは変更不要。

- [ ] **Step 6: 統合テストを cursor.test.ts に追加（不正カーソルが実エンドポイントで 400）**

`apps/server/src/services/cursor.test.ts` の末尾に、実 DB 経由で 400 になることを 1 ケース確認する describe を追加する（`listBookmarks` は login のみで到達でき最小セットアップ）:

```ts
import { afterAll, beforeEach } from 'vitest';
import { createTestUser, TEST_PASSWORD } from '../test/factories';
import { createTestApp, resetDb } from '../test/helpers';

describe('不正カーソルは実エンドポイントで 400', () => {
  const ctx = createTestApp();
  beforeEach(() => resetDb(ctx.db));
  afterAll(() => ctx.pool.end());

  it('GET /api/me/bookmarks?cursor=<garbage> は 400', async () => {
    const email = 'cursor@example.com';
    await createTestUser(ctx.db, { email });
    const login = await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
      headers: { 'content-type': 'application/json' },
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const res = await ctx.app.request('/api/me/bookmarks?cursor=!!!garbage!!!', { headers: { cookie } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION');
  });
});
```

- [ ] **Step 7: 全体テスト + typecheck**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`
Expected: 全 PASS。既存のカーソルページングテスト（comment/bookmark/notification の µs 回帰含む）が回帰なし。

- [ ] **Step 8: コミット**

```bash
git add apps/server/src/services/cursor.ts apps/server/src/services/cursor.test.ts \
  apps/server/src/services/search-service.ts apps/server/src/services/article-service.ts \
  apps/server/src/services/comment-service.ts apps/server/src/services/engagement-service.ts \
  apps/server/src/services/notification-service.ts
git commit -m "fix(server): share cursor codec and return 400 on malformed cursor"
```

---

### Task 2: best-effort 通知（M2）

**Files:**
- Modify: `apps/server/src/services/notification-service.ts`（`runNotify` 追加）
- Modify: `apps/server/src/services/comment-service.ts`（2 箇所の通知呼び出しを包む）
- Modify: `apps/server/src/services/engagement-service.ts`（1 箇所）
- Modify: `apps/server/src/services/article-service.ts`（2 箇所）
- Test: `apps/server/src/services/notification-best-effort.test.ts`（新規）

**Interfaces:**
- Consumes: `logger` from `../logger`。既存の `notifyCommentCreated` / `notifyCommentMentionsOnEdit` / `notifyReactionAdded` / `notifyArticleMentions`。
- Produces: `runNotify(label: string, fn: () => Promise<void>): Promise<void>` — `fn` の失敗を握り潰し `logger.warn` で記録する。

通知生成は副次機能。現状は seam で `await notify...()` を直接呼ぶため、通知の失敗が中核操作（コメント作成等）を 500 にしてしまう。best-effort に変える。

- [ ] **Step 1: runNotify の失敗するテストを書く**

`apps/server/src/services/notification-best-effort.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';
import { runNotify } from './notification-service';

describe('runNotify (best-effort)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fn が成功すればそのまま実行される', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await expect(runNotify('x', fn)).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('fn が reject しても throw せず logger.warn で記録する', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const err = new Error('boom');
    await expect(runNotify('reaction-added', () => Promise.reject(err))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err, notification: 'reaction-added' }),
      expect.any(String),
    );
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/server test -- notification-best-effort`
Expected: FAIL（`runNotify` が未定義）

- [ ] **Step 3: runNotify を notification-service.ts に追加**

`apps/server/src/services/notification-service.ts` の import に `logger` を追加:

```ts
import { logger } from '../logger';
```

末尾（または適切な位置）に追加:

```ts
// 通知生成は副次機能: 失敗しても中核操作（コメント/リアクション/公開）を巻き込まない。
// トランザクションでは囲まず、失敗は警告ログに記録して握り潰す（best-effort）。
export async function runNotify(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.warn({ err, notification: label }, 'notification generation failed');
  }
}
```

- [ ] **Step 4: 5 つの seam を runNotify で包む**

`apps/server/src/services/comment-service.ts` の import に `runNotify` を追加（既存の `notification-service` import 行を拡張）:

```ts
import { notifyCommentCreated, notifyCommentMentionsOnEdit, runNotify } from './notification-service';
```

`createComment` 内（現在の `await notifyCommentCreated(db, { ... });`）を:

```ts
  await runNotify('comment-created', () =>
    notifyCommentCreated(db, {
      comment: row,
      articleAuthorId: article.authorId,
      parentAuthorId: parent?.authorId ?? null,
    }),
  );
```

`updateComment` 内（現在の `await notifyCommentMentionsOnEdit(db, row);`）を:

```ts
  await runNotify('comment-mentions-edit', () => notifyCommentMentionsOnEdit(db, row));
```

`apps/server/src/services/engagement-service.ts` の import を拡張:

```ts
import { notifyReactionAdded, runNotify } from './notification-service';
```

`addReaction` 内（現在の `if (inserted.length > 0) { await notifyReactionAdded(...); }`）を:

```ts
  if (inserted.length > 0) {
    await runNotify('reaction-added', () =>
      notifyReactionAdded(db, { actorId: userId, articleId, articleAuthorId: article.authorId }),
    );
  }
```

`apps/server/src/services/article-service.ts` の import を拡張:

```ts
import { notifyArticleMentions, runNotify } from './notification-service';
```

`publishArticle` 内（現在の `await notifyArticleMentions(db, row);`）を:

```ts
  await runNotify('article-mentions-publish', () => notifyArticleMentions(db, row));
```

`updateArticle` 内（現在の `if (row.status === 'published') await notifyArticleMentions(db, row);`）を:

```ts
  if (row.status === 'published') {
    await runNotify('article-mentions-update', () => notifyArticleMentions(db, row));
  }
```

- [ ] **Step 5: テスト成功 + 3c 配線テストの回帰確認**

Run: `pnpm --filter @knowledge-hub/server test -- notification-best-effort notification-wiring`
Expected: best-effort 2/2 PASS + `notification-wiring` 全 PASS（happy path で通知は従来どおり生成される）。

- [ ] **Step 6: 全体テスト + typecheck + コミット**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`
Expected: 全 PASS

```bash
git add apps/server/src/services/notification-service.ts apps/server/src/services/notification-best-effort.test.ts \
  apps/server/src/services/comment-service.ts apps/server/src/services/engagement-service.ts \
  apps/server/src/services/article-service.ts
git commit -m "fix(server): make notification generation best-effort"
```

---

### Task 3: セキュリティヘッダ + 実用的 CSP

**Files:**
- Create: `apps/server/src/middleware/security-headers.ts`
- Create: `apps/server/src/middleware/security-headers.test.ts`
- Modify: `apps/server/src/app.ts`（既存 nosniff インライン middleware を securityHeaders に置換）

**Interfaces:**
- Consumes: `AppEnv` from `../types`。
- Produces: `securityHeaders: MiddlewareHandler<AppEnv>` — 全レスポンスに CSP + セキュリティヘッダ一式を付与。

- [ ] **Step 1: ヘッダの失敗するテストを書く**

`apps/server/src/middleware/security-headers.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test/helpers';

describe('security headers', () => {
  const ctx = createTestApp();
  afterAll(() => ctx.pool.end());

  it('全レスポンスに CSP とセキュリティヘッダが付く（/healthz で確認）', async () => {
    const res = await ctx.app.request('/healthz');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/server test -- security-headers`
Expected: FAIL（CSP ヘッダ未設定）

- [ ] **Step 3: securityHeaders ミドルウェアを実装**

`apps/server/src/middleware/security-headers.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

// 実用的 CSP: SPA（Vite ビルドを serveStatic で配信）で破損しない範囲で XSS を層防御する。
// style-src 'unsafe-inline' は多くの UI コンポーネント（Radix/shadcn のポップオーバー等）が
// インラインの位置指定 style を注入するため必須。img-src 'self' data: は外部画像をブロック
// する意図的な選択（画像はアプリ配信 /api/uploads、§8）。
const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('Content-Security-Policy', CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
};
```

- [ ] **Step 4: app.ts の既存 nosniff middleware を置換**

`apps/server/src/app.ts` の import に追加:

```ts
import { securityHeaders } from './middleware/security-headers';
```

既存の次のインライン middleware（`X-Content-Type-Options` を設定していたもの）を削除し `.use(securityHeaders)` に置換する:

```ts
    // 置換前:
    // .use(async (c, next) => {
    //   await next();
    //   c.res.headers.set('X-Content-Type-Options', 'nosniff');
    // })
    // 置換後:
    .use(securityHeaders)
```

（deps 設定 middleware と `originCheck` の間の位置は維持。`securityHeaders` が nosniff も設定するので旧 middleware は不要。）

- [ ] **Step 5: テスト成功 + 全体確認**

Run: `pnpm --filter @knowledge-hub/server test -- security-headers && pnpm --filter @knowledge-hub/server test`
Expected: security-headers PASS + 既存テスト全 PASS（既存の nosniff を検証しているテストがあれば引き続き通る）。

- [ ] **Step 6: typecheck + コミット**

Run: `pnpm --filter @knowledge-hub/server typecheck`

```bash
git add apps/server/src/middleware/security-headers.ts apps/server/src/middleware/security-headers.test.ts apps/server/src/app.ts
git commit -m "feat(server): add security headers and pragmatic CSP"
```

---

### Task 4: 構造化リクエストロギング + pg_bigm 起動チェックの堅牢化

**Files:**
- Create: `apps/server/src/middleware/request-logger.ts`
- Create: `apps/server/src/middleware/request-logger.test.ts`
- Modify: `apps/server/src/app.ts`（requestLogger 配線）
- Modify: `apps/server/src/index.ts`（pg_bigm チェックを try/catch 化）
- Modify: `apps/server/vitest.config.ts`（LOG_LEVEL=silent）

**Interfaces:**
- Consumes: `logger` from `../logger`、`AppEnv` from `../types`、`randomUUID` from `node:crypto`。
- Produces: `requestLogger: MiddlewareHandler<AppEnv>` — 各リクエストを `{ requestId, method, path, status, durationMs }` で info ログ。

- [ ] **Step 1: request-logger の失敗するテストを書く**

`apps/server/src/middleware/request-logger.test.ts`:

```ts
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';
import { createTestApp } from '../test/helpers';

describe('request logger', () => {
  const ctx = createTestApp();
  afterAll(() => ctx.pool.end());
  afterEach(() => vi.restoreAllMocks());

  it('リクエストごとに method/path/status/durationMs/requestId を info ログする', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    await ctx.app.request('/healthz');
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/healthz',
        status: 200,
        durationMs: expect.any(Number),
        requestId: expect.any(String),
      }),
      'request',
    );
  });

  it('リクエストボディはログに含めない', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    await ctx.app.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'x@example.com', password: 'super-secret-pw' }),
      headers: { 'content-type': 'application/json' },
    });
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('super-secret-pw');
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter @knowledge-hub/server test -- request-logger`
Expected: FAIL（requestLogger 未配線、info が呼ばれない）

- [ ] **Step 3: requestLogger を実装**

`apps/server/src/middleware/request-logger.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { logger } from '../logger';
import type { AppEnv } from '../types';

// 構造化リクエストログ（§13）。ボディは出さない（パスワード等の漏洩防止）。
export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();
  const requestId = randomUUID();
  await next();
  logger.info(
    {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    },
    'request',
  );
};
```

- [ ] **Step 4: app.ts に配線**

`apps/server/src/app.ts` の import に追加:

```ts
import { requestLogger } from './middleware/request-logger';
```

deps 設定 middleware の直後（`securityHeaders` の前）に `.use(requestLogger)` を追加する。順序イメージ:

```ts
    .use(async (c, next) => { /* deps 設定（既存） */ })
    .use(requestLogger)
    .use(securityHeaders)
    .use(originCheck)
```

- [ ] **Step 5: vitest でログを黙らせる**

`apps/server/vitest.config.ts` の `test` に `env` を追加:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    globalSetup: ['./src/test/global-setup.ts'],
    env: { LOG_LEVEL: 'silent' },
  },
});
```

（`logger.ts` は `pino({ level: process.env.LOG_LEVEL ?? 'info' })`。vitest は test モジュール読込前に env を適用するため silent になる。`vi.spyOn(logger, 'info')` はレベルに関係なくメソッド呼び出しを捕捉するので Step 1 のテストは成立する。）

- [ ] **Step 6: index.ts の pg_bigm チェックを try/catch 化**

`apps/server/src/index.ts` の起動時 pg_bigm チェック（トップレベル `await pool.query(...)`）を try/catch で包む。DB 不達で `serve()` 前にクラッシュするのを防ぐ（3a のバックログ Minor）:

```ts
// 検索は pg_bigm が無くても LIKE で動くが遅くなるため、欠如を運用者に知らせる。
// 起動時の DB 一時不達で serve() 前にクラッシュしないよう try/catch で保護する。
try {
  const bigm = await pool.query(`select 1 from pg_extension where extname = 'pg_bigm'`);
  if (bigm.rowCount === 0) {
    logger.warn('pg_bigm extension not installed: search runs without index acceleration');
  }
} catch (err) {
  logger.warn({ err }, 'could not verify pg_bigm extension at startup');
}
```

（`index.ts` は起動エントリで自動テストの対象外。目視で「query が try/catch に包まれ、reject 時に warn ログして serve() まで到達する」ことを確認する。）

- [ ] **Step 7: テスト成功 + 全体確認**

Run: `pnpm --filter @knowledge-hub/server test && pnpm --filter @knowledge-hub/server typecheck`
Expected: request-logger 2/2 PASS + 全既存テスト PASS（ログ出力が silent で抑制されテスト出力がクリーン）。

- [ ] **Step 8: コミット**

```bash
git add apps/server/src/middleware/request-logger.ts apps/server/src/middleware/request-logger.test.ts \
  apps/server/src/app.ts apps/server/src/index.ts apps/server/vitest.config.ts
git commit -m "feat(server): add structured request logging and harden startup check"
```

---

### Task 5: 移植可能な CI エントリポイント + GitHub Actions

**Files:**
- Modify: `package.json`（ルート、`verify` スクリプト追加）
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`（「CI / 品質ゲート」節）

**Interfaces:**
- Consumes: 各 workspace の既存スクリプト（`pnpm -r typecheck` / `pnpm -r test` / web `check:contrast` / web `build`）と `pnpm audit`。
- Produces: `pnpm run verify`（プラットフォーム非依存の品質ゲート）。GitHub Actions はこれを呼ぶだけ。

- [ ] **Step 1: ルート package.json に verify スクリプトを追加**

`package.json`（ルート）の `scripts` を次にする（既存 `test` / `typecheck` は残す）:

```json
{
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "verify": "pnpm -r typecheck && pnpm -r test && pnpm --filter @knowledge-hub/web check:contrast && pnpm --filter @knowledge-hub/web build && pnpm audit --audit-level=high"
  }
}
```

（`ci` という名前は使わない — pnpm 10 組み込みの `ci` にシャドウされる。エントリポイントは `pnpm run verify`。）

- [ ] **Step 2: verify をローカルで実行して全ゲート通過を確認**

Run: `docker compose up -d && pnpm run verify`
Expected: typecheck → test（Testcontainers で実 DB 起動）→ check:contrast → web build → `pnpm audit` の順に全て成功して終了コード 0。

（注意: `pnpm audit` は high/critical の脆弱性があると非ゼロ終了する。もし既存依存に high/critical があって落ちる場合は、それ自体が 4a で解消すべき対象。可能なら `pnpm update` で解消、解消できない移行的な既知脆弱性があればこの Step で内容を報告し、`pnpm audit` の扱い（当該 advisory の許容可否）を人間に確認する。勝手に `|| true` で握り潰さない。）

- [ ] **Step 3: GitHub Actions ワークフローを作成**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run verify
```

（Testcontainers 用の Docker は ubuntu-latest に標準搭載・起動済みのため追加設定不要。CI の実体は `pnpm run verify` のみで、この yaml は薄いアダプタ。）

- [ ] **Step 4: README に「CI / 品質ゲート」節を追加**

`README.md` の「テスト / 型チェック」節の後に、以下の内容の `### CI / 品質ゲート` 節を追加する（フェンスは通常のバッククォート 3 個）:

- 見出し: `### CI / 品質ゲート`
- 本文（要旨）: 品質ゲートの実体はプラットフォーム非依存の単一エントリポイント `pnpm run verify` に集約している。
- `bash` フェンスのコードブロック 1 つに、コマンドとその内訳コメントを入れる:
  - `pnpm run verify   # typecheck → test（Testcontainers 実 DB）→ コントラスト検査 → web build → 依存脆弱性チェック`
- 続く本文（要旨）: `pnpm run verify` はローカルでもそのまま実行できる。GitHub Actions（`.github/workflows/ci.yml`）はこのコマンドを呼ぶだけの薄いアダプタで、push（main）と Pull Request で自動実行される。GitLab CI や Jenkins へ移行する場合も同じ `pnpm run verify` を呼ぶ薄い設定を書くだけでよく、ゲートの実体はリポジトリ側に残る（オンプレ / クラウドの差分を薄いアダプタで吸収する本プロジェクトの方針に沿う）。

- [ ] **Step 5: 最終確認 + コミット**

Run: `pnpm run verify`
Expected: 終了コード 0（全ゲート通過）

```bash
git add package.json .github/workflows/ci.yml README.md
git commit -m "ci: add portable verify entrypoint and github actions adapter"
```

---

## 最終確認（全タスク完了後）

- [ ] `docker compose up -d` の状態で `pnpm run verify` → 全ゲート通過（終了コード 0）
- [ ] 最終レビュー観点（whole-branch review へ引き継ぐ）:
  - 5 サービスのローカル encode/decode が完全に削除され、全て `cursor.ts` を import していること（`grep -rn "function decodeCursor" apps/server/src` が 0 件）
  - 不正カーソルが 400 になり、正常なページング（µs 回帰テスト含む）が回帰していないこと
  - 5 つの通知 seam がすべて `runNotify` 経由で、直接 `await notify...()` が残っていないこと（`grep -rn "await notify" apps/server/src/services` が 0 件）
  - 全レスポンスに CSP + セキュリティヘッダが付き、CSP 文字列が Global Constraints と完全一致すること
  - リクエストログにボディ（パスワード等）が漏れないこと
  - `pnpm ci` ではなく `pnpm run verify` がエントリポイントで、ワークフローがそれを呼ぶだけであること
  - 既存 API のレスポンス形状が不変で、web の `hc<AppType>` typecheck がクリーンなこと
