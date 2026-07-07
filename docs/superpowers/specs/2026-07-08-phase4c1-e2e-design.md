# Phase 4c-1: E2E スイート（Playwright）設計

- 日付: 2026-07-08
- ステータス: 承認済み（実装前）
- 位置づけ: Phase 4c を 2 分割した前半。**4c-1 = E2E スイート**（本書）→ 4c-2 = 本番化仕上げ（M-6 SMTP / M-7 S3・serveStatic・HSTS + Minor 横断掃除）。

## 1. 背景・目的

UI が S1〜S5 で安定した今、主要ユーザーフローをブラウザ経由で通しで検証する回帰安全網を張る。これまでのブラウザ検証はコントローラーの ad-hoc スクリプト（scratchpad、セッション限り）で、リポジトリに残る E2E 資産はゼロ。4c-2 でサーバー設定（SMTP/S3/HSTS）を触る前に、壊れたら即分かる状態を作る。

## 2. ユーザー決定事項（確定）

1. **4c は 2 分割**: 4c-1 = E2E 先行、4c-2 = 本番化仕上げ。
2. **SSO（Keycloak）はローカル限定の optional スイート**: Keycloak 未起動なら skip、CI では回さない。
3. **CI へは別ジョブで組み込む**: 既存 verify ジョブは不変。実体はルート pnpm スクリプトに集約し GH Actions は薄いアダプタ（4a の CI 方針踏襲）。
4. **専用の隔離スタック**: E2E 専用 compose プロジェクト（別ポートの db/mailpit/minio）を起動し、毎回クリーンな DB に migrate + seed。dev 環境（demo 記事入り）とは無干渉。

## 3. スコープ

### 対象
- 新 workspace パッケージ `tests/e2e`（`@knowledge-hub/e2e`、`@playwright/test`）
- `docker-compose.e2e.yml`（ポートオーバーレイ）+ ルート pnpm スクリプト（`e2e:up` / `e2e` / `e2e:down` 等）
- `.github/workflows/ci.yml` への並列 `e2e` ジョブ追加
- E2E 用 env（`.env.e2e`。隔離スタックのローカルポート・compose 記載済みの dev 認証情報のみ＝コミット可）
- 最小の設定変更: `apps/web/vite.config.ts` の proxy 先 env 化（デフォルト不変）、`apps/server/package.json` に `start:e2e` 等のスクリプト追加、Keycloak dev realm の redirect URI に E2E ポート追記

### 非対象
- アプリ挙動の変更（セレクタ都合の `data-testid` 追加まで。それ以上の変更が必要なら実装を止めて報告）
- M-6/M-7・Minor 掃除（4c-2）
- `pnpm run verify` への E2E 組み込み（verify は高速なユニット/統合の門番のまま）
- 負荷・視覚回帰（スクリーンショット diff）テスト

## 4. アーキテクチャ

### 4.1 実行対象（プロセス構成）
```
Playwright (tests/e2e)
  → web: 本番ビルドを vite preview で配信（port 54173）
      /api → API サーバーへ proxy（preview.proxy は server.proxy を継承。
             proxy 先は env E2E_API_URL 等で上書き、未設定時は従来の :3000）
  → api: tsx --env-file=.env.e2e src/index.ts（port 53000）
      → 隔離スタック（db :55432 / mailpit :58025(UI+REST),:51025(SMTP) / minio :59000）
```
- **本番バンドルを踏む理由**: 4a の theme-init/CSP のような「本番ビルドでのみ出る退行」を捕まえるため。dev サーバー（vite dev）は使わない。
- **フォールバック**: `vite preview` の proxy 継承が期待どおり動かない場合のみ、preview 用 proxy を明示設定（それでもダメなら dev サーバー方式に切替可、計画で先に検証タスクを置く）。
- プロセス起動は Playwright の `webServer`（複数指定）に集約し、ローカルも CI も同一パスにする。ポートは dev（3000/5173）と非衝突なので dev サーバー稼働中でも E2E を回せる。

### 4.2 隔離スタック
- `docker compose -p khub-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d db mailpit minio minio-setup`
- オーバーレイはポートの差し替えのみ（db 55432 / mailpit 58025・51025 / minio 59000・59001）。ボリュームは compose プロジェクト名で自然に分離される。
- 実行前に `db:migrate` + `seed:admin` を `.env.e2e` で実行（毎回同じ初期状態）。`e2e:down` は `-v` でボリュームごと破棄。

### 4.3 テストデータ戦略と実行順序
- シード = admin（admin@example.com / change-me-please-12）のみ。
- **Playwright の setup プロジェクト（project dependencies）** を使う。spec ファイルのアルファベット順に依存させない:
  - `setup/auth.setup.ts` — admin でログインし **storageState（admin.json）** を保存。続けて **admin 招待 → Mailpit REST API でリンク取得 → 受諾 → member 作成**（招待フローのアサーションはここで実施 = invite spec を兼ねる）→ member の storageState（member.json）を保存。
  - 本体プロジェクトは setup に依存し、各 spec は保存済み storageState でログイン状態から開始（ログイン UI 自体は auth.spec が独立に検証）。
- カテゴリは article spec の冒頭で admin がカテゴリ管理 UI から作成（AdminCategoriesPage の E2E を兼ねる）。
- 記事タイトル等は spec ごとにタイムスタンプ付き一意文字列。
- **workers=1（直列）** で開始。並列化は将来の最適化（spec 間で feed 状態を共有するため）。

## 5. スイート構成

| # | spec ファイル | フロー | 主なアサーション |
|---|---|---|---|
| 1 | auth.spec.ts | パスワードログイン成功/失敗・ログアウト | 失敗時 role=alert、成功でフィード、ログアウトで /login |
| 2 | setup/auth.setup.ts | （setup プロジェクト）admin ログイン → 招待 → Mailpit REST でリンク取得 → 受諾 → member 作成、両者の storageState 保存 | 招待メール受信、受諾後の自動ログイン、member ロール |
| 3 | article.spec.ts | カテゴリ作成（admin UI）→ S5 エディタで記事作成 → 自動保存 → 公開パネル → 公開 → 詳細 → フィード | 保存インジケータ「保存しました」、**カテゴリ必須ガード（未選択で公開ボタン disabled + ⚠）**、公開後 URL /articles/<uuid>、フィードにカード |
| 4 | hero.spec.ts | ヒーロー画像アップロード（実 MinIO 往復）→ エディタプレビュー → 詳細ヒーロー → 一覧サムネ | HeroImage の前景 img 表示、詳細 16:9 contain、フィードの 4:3 サムネ |
| 5 | search.spec.ts | 公開記事の検索ヒット + **下書き固有語の非漏洩** | ヒット表示・スニペット、下書き語で 0 件 |
| 6 | engagement.spec.ts | コメント → 返信 → リアクション → ブックマーク → ブックマーク一覧 | コメント表示・返信ネスト、リアクション数、ブックマーク一覧掲載 |
| 7 | notification.spec.ts | member が admin 記事にコメント → admin にベル未読バッジ → 通知一覧 → 既読化 | バッジ数、通知行の内容、既読でバッジ消滅 |
| 8 | mobile.spec.ts | 375px: ハンバーガー → ドロワー → ナビ遷移 | ドロワー開閉、遷移でドロワー閉、横スクロールなし |
| 9 | sso.spec.ts（optional） | SSO ボタン → Keycloak ログイン → JIT → member 到達 | /me 相当の表示が member/oidc。**Keycloak（dev compose profile idp、:8080）未起動なら test.skip**。CI 対象外 |

## 6. CI 統合

`.github/workflows/ci.yml` に verify と並列の `e2e` ジョブ:
1. checkout / pnpm / node（verify ジョブと同一セットアップ）
2. `pnpm install --frozen-lockfile`
3. `pnpm exec playwright install chromium --with-deps`（キャッシュ利用）
4. `pnpm run e2e:up`（compose 起動 + migrate + seed）
5. `pnpm run e2e`（web build → preview + server 起動 → Playwright。sso.spec は Keycloak 不在で自動 skip）
6. 失敗時 trace / screenshot を actions/upload-artifact で保存

## 7. 決定論性・フレーク対策

- 直列実行（workers=1）・spec 単位の一意データ・自動リトライは CI のみ 1 回（`retries: process.env.CI ? 1 : 0`）
- 時刻依存アサーションなし（「保存しました」等の状態テキストで待つ。任意 sleep 禁止、Playwright の auto-wait/`expect` ポーリングを使う）
- Mailpit はテスト冒頭で `DELETE /api/v1/messages`（隔離スタックなので安全）

## 8. 完了基準

1. ローカル: `pnpm run e2e:up && pnpm run e2e` で 8 spec（+ Keycloak 起動時 9 spec）全緑
2. CI: e2e ジョブが verify と並列で緑
3. `pnpm run verify` は従来どおり緑・所要時間ほぼ不変
4. dev 環境（:3000/:5173、khub DB）への影響ゼロ（E2E 実行中も dev サーバー併走可）

## 9. 4c-2 への申し送り

- M-6（SMTP 認証/TLS）・M-7（production S3 必須化・serveStatic 絶対パス・HSTS）
- CSP 配信込みの本番同等 E2E（server の serveStatic で dist を配る構成）は M-7 解消後に検討
- Minor 横断掃除（M-1〜M-11 + 各フェーズ DEFER。S5 分: 公開パネルが publish 前に閉じる/保存表示の二重）
