# knowledge-hub

> チームのためのブログ型ナレッジ共有サービス。

チームや組織の知見を蓄積・共有するための、ブログ中心のナレッジ共有サービス。数十〜百人規模での運用を想定しています。記事は **Markdown を正**として管理し、2 階層カテゴリ + フリータグで分類、全体フィードを主役に据えます。オンプレ / クラウド（AWS）の両対応（差分は環境変数のみ）を前提に設計しています。

## 主な機能

- **認証** — 招待制ログイン、セッション、パスワードリセット、ユーザー管理（有効化 / 無効化・ロール）。OIDC 汎用ログイン（PKCE・JIT プロビジョニング・email 自動リンク・ドメイン制限）にも対応し、パスワード認証との共存 / OIDC 専用運用を切り替え可能。
- **記事** — 作成・下書き / 公開・論理削除 / 復元・リビジョン・楽観ロック・ピックアップ（ピン留め）。エディタは **リッチ（Tiptap）⇔ Markdown ソース（CodeMirror）** の切替式で、両者は無損失往復する。ヒーロー画像・画像 D&D / ペースト（S3 互換ストレージへ magic-byte 検証付きアップロード）。
- **分類・検索** — 2 階層カテゴリ（公開時必須）+ フリータグ、全体 / カテゴリ / タグ / 著者の各フィード（カーソルページング）。pg_bigm による日本語部分一致の全文検索 + スニペット + 絞り込み。
- **ソーシャル** — コメント（フラット + 1 階層返信・Markdown・論理削除）、リアクション（絵文字プリセット・楽観的更新）、ブックマーク、著者プロフィールページ + アバター。
- **通知** — アプリ内通知（ベル + 未読バッジ + 一覧・既読管理）。コメント / 返信 / リアクション / @メンションが契機。メンションはコメント欄でオートコンプリート。
- **UI/UX** — サイドバー型アプリシェル（モバイルはドロワー）、統一記事カード、インディゴ配色（ライト / ダーク・コントラスト AA）、執筆没入エディタ。
- **運用** — セキュリティヘッダ + CSP、構造化リクエストログ、SMTP 認証 / TLS、production での設定 fail-fast・HSTS。品質ゲートはプラットフォーム非依存の `pnpm run verify` に集約し、E2E（Playwright）を隔離スタックで実行。

## 技術スタック

- **Server:** [Hono](https://hono.dev/)（Node.js / ESM） + [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL（[pg_bigm](https://github.com/pgbigm/pg_bigm) 全文検索）
- **Web:** React 19 SPA（[Vite](https://vitejs.dev/)） + [TanStack Query](https://tanstack.com/query) + React Router + [shadcn/ui](https://ui.shadcn.com/) / Tailwind v4 + [Tiptap](https://tiptap.dev/)（リッチ） / [CodeMirror 6](https://codemirror.net/)（ソース）
- **Shared:** TypeScript 統一 / [Zod](https://zod.dev/) スキーマ（サーバー・Web 双方が参照）
- **画像ストレージ:** S3 互換（オンプレ = MinIO / AWS = S3）
- **認証:** セッション（パスワード）+ OIDC（[openid-client](https://github.com/panva/node-openid-client) + PKCE）
- **テスト:** Vitest + [Testcontainers](https://testcontainers.com/)（実 PostgreSQL 起動）/ [Playwright](https://playwright.dev/)（E2E）
- **モノレポ:** pnpm workspaces

## リポジトリ構成

```
apps/
  server/        Hono API（認証・記事・カテゴリ・タグ・通知・アップロード）
  web/           React SPA
packages/
  shared/        共有 Zod スキーマ・型・エラーコード（サーバー / Web の契約）
tests/
  e2e/           Playwright E2E スイート
docs/            設計書・実装計画
```

## 開発の始め方

前提: Node.js 24 系 / pnpm 10 / Docker

```bash
pnpm install
cp .env.example apps/server/.env                # server は apps/server/.env を読む。値は必要に応じて調整
docker compose up -d                            # PostgreSQL + Mailpit + MinIO（画像バケットは自動作成）
pnpm --filter @knowledge-hub/server db:migrate  # マイグレーション適用
pnpm --filter @knowledge-hub/server seed:admin  # 初期 admin 作成

# 別ターミナルでそれぞれ起動
pnpm --filter @knowledge-hub/server dev         # API
pnpm --filter @knowledge-hub/web dev            # Web (http://localhost:5173)
```

### SSO（OIDC）の手動検証（任意）

```bash
docker compose --profile idp up -d   # 開発用 Keycloak を起動（普段は起動不要）
```

`apps/server/.env` の OIDC 3 変数（`OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`）のコメントを外して有効化し、サーバーを再起動する。ログイン画面の「SSO でログイン」から Keycloak のログイン画面に遷移し、`sso-taro` / `sso-dev-password` でログインできる。

### テスト / 型チェック

```bash
docker compose up -d        # server の統合テストは Testcontainers で実 DB を使う
pnpm test                   # 全パッケージのテスト
pnpm typecheck              # 全パッケージの型チェック
```

### CI / 品質ゲート

品質ゲートの実体はプラットフォーム非依存の単一エントリポイント `pnpm run verify` に集約している。

```bash
pnpm run verify   # typecheck → test（Testcontainers 実 DB）→ コントラスト検査 → web build → 依存脆弱性チェック
```

`pnpm run verify` はローカルでもそのまま実行できる。GitHub Actions（`.github/workflows/ci.yml`）はこのコマンドを呼ぶだけの薄いアダプタで、push（main）と Pull Request で自動実行される。GitLab CI や Jenkins へ移行する場合も同じ `pnpm run verify` を呼ぶ薄い設定を書くだけでよく、ゲートの実体はリポジトリ側に残る（オンプレ / クラウドの差分を薄いアダプタで吸収する本プロジェクトの方針に沿う）。

E2E（Playwright）は専用の隔離スタック（compose プロジェクト `khub-e2e`、別ポート）で動き、dev 環境と同居できる。

```bash
pnpm run e2e:up     # 隔離スタック起動 + migrate + seed（初回/リセット時）
pnpm run e2e        # web を本番ビルドして全 E2E を実行
pnpm run e2e:down   # スタックとボリュームを破棄
```

SSO spec は dev Keycloak（`docker compose --profile idp up -d`）起動時のみ実行され、未起動なら自動 skip する。CI では verify と並列の `e2e` ジョブが同じコマンドを呼ぶ。

## アーキテクチャ・貢献

設計・アーキテクチャの要点と開発規約は [`AGENTS.md`](./AGENTS.md) にまとめている。設計書・実装計画の詳細は [`docs/`](./docs/) を参照。
