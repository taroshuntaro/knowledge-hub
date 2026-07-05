# knowledge-hub

> **⚠️ WIP** — チームのためのブログ型ナレッジ共有サービス。開発中（Phase 2a まで完了）です。

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

### テスト / 型チェック

```bash
docker compose up -d        # server の統合テストは Testcontainers で実 DB を使う
pnpm test                   # 全パッケージのテスト
pnpm typecheck              # 全パッケージの型チェック
```

## 進捗

- [x] **Phase 1** — 基盤・認証（招待制ログイン、セッション、パスワードリセット、ユーザー管理）
- [x] **Phase 2a** — 記事バックエンド + 閲覧画面 + Markdown ソースエディタ（CodeMirror）
  - 記事の作成 / 下書き・公開 / 論理削除・復元 / リビジョン / 楽観ロック / ピックアップ
  - 2 階層カテゴリ・フリータグ、カーソルページング、S3 互換画像アップロード（magic-byte 検証）
  - Markdown サニタイズ表示（rehype-sanitize）
- [ ] **Phase 2b** — リッチ Tiptap ⇔ Markdown 無損失往復、画像 D&D
- [ ] **Phase 3** — 全文検索（pg_bigm）、コメント / リアクション / 通知
- [ ] **Phase 4** — OIDC、E2E、CI、仕上げ

設計・計画の詳細は [`docs/`](./docs/) を参照。
