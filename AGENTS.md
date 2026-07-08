# AGENTS.md

knowledge-hub のリポジトリ内で作業するエージェント / コントリビューター向けの指針。ユーザー / プロダクトの説明は [`README.md`](./README.md)、設計・実装計画は [`docs/`](./docs/) を参照。

> `CLAUDE.md` はこのファイルへのシンボリックリンク（実体は `AGENTS.md` の 1 つ）。

## プロジェクト概要

チーム向けのブログ型ナレッジ共有サービス。pnpm モノレポ。記事は Markdown を正とし、サーバー（Hono + Drizzle + PostgreSQL）と Web（React SPA）が `packages/shared` の Zod スキーマを契約として共有する。オンプレ / クラウド両対応で、差分は環境変数のみに閉じる設計。

## セットアップと主要コマンド

```bash
pnpm install
cp .env.example apps/server/.env
docker compose up -d                            # PostgreSQL + Mailpit + MinIO
pnpm --filter @knowledge-hub/server db:migrate
pnpm --filter @knowledge-hub/server seed:admin

pnpm --filter @knowledge-hub/server dev         # API (:3000)
pnpm --filter @knowledge-hub/web dev            # Web (:5173, /api は :3000 へ proxy)
```

- **検証ゲート:** `pnpm run verify`（typecheck → test → contrast → web build → `pnpm audit`）。**変更を出す前に必ず green にする。**
- **テスト単体:** `pnpm test` / パッケージ個別は `pnpm --filter @knowledge-hub/<pkg> test`。
- **E2E:** `pnpm run e2e:up` → `pnpm run e2e` → `pnpm run e2e:down`（compose プロジェクト `khub-e2e`、別ポートで dev と同居可）。
- **マイグレーション:** スキーマは `apps/server/src/db/schema.ts` が正。変更後 `pnpm --filter @knowledge-hub/server db:generate` で差分 SQL を生成し、`db:migrate` で適用する（**手書きしない**）。Testcontainers テストは起動時に自動でマイグレーションを当てる。

## モノレポ構成と責務

```
apps/server/src/
  app.ts          buildApp（ルート組み立て）。AppType を export（web の型付きクライアントの元）
  routes/         Hono ルート。guards.ts に requireUuidParam などのパラメータ検証
  services/       ドメインロジック（記事・カテゴリ・タグ・コメント・エンゲージメント・通知・アップロード ほか）
  middleware/     session / admin / security-headers / request-logger / password-auth ほか
  db/schema.ts    Drizzle スキーマ（マイグレーションの発生源）
  config.ts       Zod 検証済みの環境設定 / errors.ts  AppError / logger.ts  pino
packages/shared/  Zod スキーマ・型・ERROR_CODES（サーバー / Web が参照する唯一の契約）
apps/web/src/
  api/            hc<AppType> クライアント（client.ts）と各リソースのフック
  auth/           useMe / RequireAuth / RequireRole
  lib/            api-error（errorMessage / NETWORK_ERROR_MESSAGE）・markdown・date ほか
  components/  pages/
tests/e2e/        Playwright
```

## アーキテクチャ規約（変更時に踏襲すること）

- **契約は shared に集約:** リクエスト / レスポンスの形と `ERROR_CODES` は `packages/shared` の Zod スキーマが唯一の正。サーバーはそれで検証し、Web は `hc<AppType>` の型推論で end-to-end に型を通す。**`as` での握り潰しや型の再定義を増やさない。**
- **エラー:** サーバーは `AppError(code, message, status)` を投げ、`middleware/error-handler.ts` が整形する。Web は非 2xx の本文を `lib/api-error.ts` の `errorMessage(res, fallback)` で取り出し、通信例外は `NETWORK_ERROR_MESSAGE` を使う（文言をベタ書きしない）。
- **記事の可視性:** 「公開かつ未削除」の判定は `services/article-visibility.ts`（`publishedArticleWhere` / `isArticleVisible` / `assertPublishedArticle`）に一元化。認可の要なので各所にコピーせずここを使う。
- **カーソルページング:** `services/cursor.ts` の `encodeCursor` / `decodeCursor` を共有。DB の `now()`（µs）と JS `Date`（ms）の精度差で行がスキップされないよう、WHERE / ORDER BY の両方で `date_trunc('milliseconds', ...)` キーを使うパターンを踏襲する。Web 側は `api/cursor-list.ts` の `useCursorList(queryKey, fetchPage)` でページングの定型を共有。
- **パラメータ検証:** UUID などのパス検証は `routes/guards.ts` の `requireUuidParam` をルート層で使う（サービス層へ押し下げない）。
- **認可:** ルートの保護は `middleware`（session / admin / `password-auth` の `requirePasswordAuth`）で。Web のルートガードは `auth/RequireAuth`・`RequireRole`。
- **秘密情報:** パスワード・トークン・生の認証情報は絶対にログへ出さない（`request-logger` は routePath のみでトークンを含むパスを出さない）。`.env` は gitignore。

## コーディング / テスト規約

- TypeScript を全域で使用（strict）。テストは対象と同じディレクトリに `*.test.ts(x)` で併置。
- サーバーのサービス層テストは Testcontainers で実 PostgreSQL を使う（Docker 起動が前提）。
- Web の UI 文言は日本語。日付は `lib/date.ts`、カテゴリ色は `lib/category-color.ts` を使う。
- コンポーネント / 色を追加したらコントラスト検査（`pnpm --filter @knowledge-hub/web check:contrast`）を green に保つ（verify に含まれる）。

## コミット / ブランチ

- コミットメッセージは英語・[Conventional Commits](https://www.conventionalcommits.org/)（`feat` / `fix` / `refactor` / `docs` / `test` / `chore` ...）。subject は命令形・50 字程度・末尾ピリオドなし。1 コミット = 1 論理変更。
- main へ直接コミットせず作業ブランチを切る。ローカル統合は `--no-ff` マージを基本とする。
- リモートへの push は勝手に行わず、明示的な指示 / 確認のうえで行う。
