# knowledge-hub

> **⚠️ WIP** — チームのためのブログ型ナレッジ共有サービス。開発中（UI/UX 刷新まで完了）です。

チームや組織の知見を蓄積・共有するための、ブログ中心のナレッジ共有サービス。数十〜百人規模での運用を想定しています。記事は **Markdown を正**として管理し、2 階層カテゴリ + フリータグで分類、全体フィードを主役に据えます。オンプレ / クラウド（AWS）の両対応（差分は環境変数のみ）を前提に設計しています。

## 技術スタック

- **Server:** [Hono](https://hono.dev/)（Node.js / ESM） + [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL
- **Web:** React SPA（[Vite](https://vitejs.dev/)） + TanStack Query + React Router + [CodeMirror 6](https://codemirror.net/)
- **Shared:** TypeScript 統一 / [Zod](https://zod.dev/) スキーマ（サーバー・Web 双方が参照）
- **画像ストレージ:** S3 互換（オンプレ = MinIO / AWS = S3）
- **テスト:** Vitest + [Testcontainers](https://testcontainers.com/)（実 PostgreSQL 起動）
- **モノレポ:** pnpm workspaces

## リポジトリ構成

```
apps/
  server/        Hono API（認証・記事・カテゴリ・タグ・アップロード）
  web/           React SPA
packages/
  shared/        共有 Zod スキーマ・型・エラーコード
docs/            設計書・実装計画
```

## 開発の始め方

前提: Node.js 22 系 / pnpm 10 / Docker

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

## 進捗

- [x] **Phase 1** — 基盤・認証（招待制ログイン、セッション、パスワードリセット、ユーザー管理）
- [x] **Phase 2a** — 記事バックエンド + 閲覧画面 + Markdown ソースエディタ（CodeMirror）
  - 記事の作成 / 下書き・公開 / 論理削除・復元 / リビジョン / 楽観ロック / ピックアップ
  - 2 階層カテゴリ・フリータグ、カーソルページング、S3 互換画像アップロード（magic-byte 検証）
  - Markdown サニタイズ表示（rehype-sanitize）
- [x] **Phase 2b-1** — デザイン基盤（shadcn/ui + Tailwind v4、デザイントークン、ライト/ダークテーマ）+ 全画面刷新
- [x] **Phase 2b-2** — リッチ Tiptap ⇔ Markdown 無損失往復、画像 D&D/ペースト、コードハイライト・タスクリスト表示
- [x] **Phase 3a** — 全文検索（pg_bigm 日本語部分一致 + スニペット、カテゴリ / タグ / 著者絞り込み）、著者プロフィールページ + アバターアップロード
- [x] **Phase 3b** — コメント（フラット + 1 階層返信・Markdown・論理削除）、リアクション（絵文字プリセット・楽観的更新）、ブックマーク（トグル + 一覧ページ）
- [x] **Phase 3c** — アプリ内通知（ベル + 未読バッジ + 一覧・既読管理、コメント / 返信 / リアクション / メンションが契機）、@メンション（コメント・記事本文の検出、コメント欄オートコンプリート）
- [x] **Phase 4a** — CI・本番化（移植可能な `pnpm run verify` + GitHub Actions、セキュリティヘッダ + CSP、構造化リクエストログ、共有カーソル codec、best-effort 通知、依存脆弱性修正）
- [x] **Phase 4b** — OIDC 汎用ログイン（openid-client + PKCE、JIT プロビジョニング、email 自動リンク、ドメイン制限、パスワード認証との共存 / OIDC 専用運用）
- [x] **UI/UX 刷新** — サイドバー型アプリシェル、記事サムネイル、インディゴ配色、執筆没入エディタ、情報設計・一貫性の底上げ（S1〜S5）
  - [x] **S1** — デザイントークン（インディゴ・AA 再検証）+ アプリシェル（サイドバー / モバイルドロワー = Radix Dialog・カテゴリ 2 階層・アカウントメニュー）
  - [x] **S2** — 記事ヒーロー画像（スキーマ + エディタ設定 + 一覧 API 拡張）
  - [x] **S3** — 統一記事カード + フィード / ピックアップ + 各一覧画面
  - [x] **S4** — 記事詳細 / 検索統合 / 認証・設定・管理 + 一貫性パス
  - [x] **S5** — 記事エディタ執筆没入化（記事体裁キャンバス・sticky アクションバー・ヒーロー 16:9 contain＋ぼかし背景・公開パネルへメタ分離・一覧サムネ 4:3）
- [ ] **Phase 4c** — E2E（Playwright 主要フロー）+ 仕上げ

設計・計画の詳細は [`docs/`](./docs/) を参照。
