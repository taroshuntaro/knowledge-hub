# Phase 4c-2: 本番化仕上げ 設計

- 日付: 2026-07-08
- ステータス: 承認済み（実装前）
- 位置づけ: Phase 4c の後半。4c-1（E2E スイート）完了済み。本フェーズで**本番投入前必須の 2 件（M-6/M-7）**と、正確性/堅牢性に効くバックログ 6 件を修正し、残りは理由付きでクローズ/将来送りにする。

## 1. ユーザー決定事項（triage、承認済み）

- **A. 本番前必須**: M-6（SMTP 認証/TLS）・M-7（production fail-fast + serveStatic 絶対パス + HSTS、4b DEFER #6 の確認込み）
- **B. 正確性/堅牢性 6 件**: M-1・M-3・M-10・M-5・S5 保存表示二重・タイトル空公開の明示
- **C. 対応しない/将来送り**: M-2（レートリミッタ強化）・M-8（インデックス不整合）・M-9（storage.get 障害 404 化）・M-11（メンションラベル、許容済み）・4b #3/#4・reactionCount distinct・ピン二重表示・バンドル分割・その他 cosmetic 群 — **理由付きで台帳に記録して閉じる**（コード変更なし）

## 2. A-1: M-6 — SMTP 認証/TLS（本番対応）

現状 `createSmtpMailer` は `host/port` のみで `secure: false` 固定・認証なし（Mailpit 専用）。本番 SMTP（SES SMTP、社内リレー等）に接続できるようにする。

- config に追加（すべて任意・未設定なら現挙動 = Mailpit 互換のまま）:
  - `SMTP_USER` / `SMTP_PASSWORD`（両方セットで `auth` を渡す。**片方のみは起動時エラー**、OIDC 3 点セットと同じ形式）
  - `SMTP_SECURE`（`'true' | 'false'`、default `'false'`。true で implicit TLS/465。587 STARTTLS は nodemailer が `secure:false` でも自動ネゴシエートするため専用フラグは設けない）
- `createSmtpMailer` は `secure` と `auth`（あれば）を transport に渡すだけ。`send` の署名・呼び出し側は無改変。
- **パスワードはログに出さない**（既存方針。config を丸ごとログしない現状を維持）。
- テスト: config 単体（片方のみでエラー / 両方で auth 構成）+ mailer は transport 生成引数の検証（nodemailer をモックし createTransport 引数を assert）。

## 3. A-2: M-7 — production fail-fast + serveStatic 絶対パス + HSTS

### 3.1 production fail-fast（S3）
`NODE_ENV=production` のとき、次を **loadConfig で起動時エラー**にする:
- `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` が既定値（`minioadmin`）のまま（＝明示設定なし）。IAM ロール等でキーレス運用する場合は将来 `S3_AUTH=iam` のような明示オプトインを足す（今回は範囲外、既定値混入の事故防止が目的）。
- あわせて 2a 既知 footgun「`S3_ENDPOINT` 未設定で実 AWS に黙って接続」は、production では意図された挙動（AWS S3）なので**エラーにしない**。dev/test で誤って実 AWS に行く問題は S3_ENDPOINT を .env/.env.e2e が常に持つ運用で既に緩和済み（変更なし、台帳に判断を記録）。

### 3.2 serveStatic 絶対パス
`apps/server/src/index.ts` の `serveStatic({ root: '../web/dist' })` は **cwd 依存**（apps/server 以外から起動すると 404）。`import.meta` 基準の絶対パス（`fileURLToPath` で `apps/web/dist` を解決）に変更し、cwd に依らず同じ場所を指すようにする。`WEB_DIST_DIR` env で上書き可（コンテナ配置替え用、任意）。
（注: `serveStatic` の `root` は相対パス前提の実装があるため、実装時に絶対パスがそのまま通るか確認し、通らなければ `process.cwd()` からの相対に正規化して渡す。受け入れ基準は「リポジトリルートから起動しても dist が配信される」こと。）

### 3.3 HSTS
セキュリティヘッダ middleware（4a 導入）に `Strict-Transport-Security: max-age=31536000; includeSubDomains` を追加。**production のみ**（dev の http で HSTS を配ると事故るため）。`preload` は付けない（登録運用を前提にしないため）。

### 3.4 4b DEFER #6 の確認
`allowInsecure`（OIDC の http 許可）が NODE_ENV デフォルトに依存する件: production で `allowInsecure` にならないことをテストで固定（挙動変更が必要なら最小修正）。

## 4. B 群（正確性/堅牢性）

### 4.1 M-1: PATCH /api/categories/:id の `{}` → 500
categoryUpdateSchema に「name / parentId の少なくとも一方が必要」の `refine` を追加し、空ボディを **VALIDATION 400** にする。回帰テスト（`{}` → 400）。

### 4.2 M-3: リセット/招待トークンの単回使用が非トランザクション
現状「検証 → 使用済み化」が別ステップで、同一トークンの並行使用に窓がある。**トークン消費（used/accepted への更新）を条件付き UPDATE（`WHERE ... AND 未使用`）または tx** にし、2 回目を確実に拒否する。並行 2 重使用の回帰テスト（片方 200・片方 4xx）。password-reset と invitation の両方。

### 4.3 M-10: ゴミ箱内公開記事だけを持つカテゴリの削除 → restore で不変条件破壊
`deleteCategory` は記事を付け替えるが、**論理削除中の記事**の扱いにより「restore したら published なのに categoryId が無効/NULL」になり得る。修正方針: deleteCategory の付け替え対象に**削除済み記事も含める**（restore 後も有効なカテゴリを指す）。回帰テスト: 公開→ゴミ箱→カテゴリ削除→restore で記事のカテゴリが有効（またはサービスの既存再付け替え規約に従い reassignToId に付く）。

### 4.4 M-5: web ミューテーションの fetch 例外未処理
`await api...$post/$patch/$delete` が **ネットワーク例外**（fetch reject）で unhandled になる箇所を全 web ページ/コンポーネントで走査し、`try/catch` + 既存のエラー表示規約（`role="alert"` / actionError）に揃える。対象は走査で確定（計画時に一覧化）。挙動は「失敗が黙殺されない」への統一のみ。

### 4.5 S5 DEFER: 保存表示の二重
EditorPage で保存状態がアクションバー（`savingLabel`: 保存済み等）とキャンバス（`status`: 「保存しました」）の 2 箇所に出る。**アクションバーに一本化**する: 保存成功時の `setStatus('保存しました')` をやめる（`saveState` が担う）。`status` は「Markdown モードで開きました」等の**情報メッセージ専用**に残す。既存テストの「保存しました」アサーションは `保存済み`（バー）へ追随（弱めない: 保存完了を示す表示の検証は維持）。E2E article.spec の exact 回避コメントも簡素化できるが、E2E は変更必須ではない。

### 4.6 タイトル空で公開が無音 no-op
`save()` は title 空で null を返し、publish は静かに中断する。**公開パネル側で明示**: タイトル未入力なら公開実行ボタンを disabled にし「タイトルを入力してください」を表示（カテゴリ必須ガードと同じ様式）。既存の無音 no-op 経路は残っていても UI で先回りされる。テスト: タイトル空でパネルを開くと公開ボタン disabled + 文言表示。

## 5. スコープ外（C 群 — コード変更なし、台帳へ記録して閉じる）

M-2（内部ツール規模でレートリミッタ強化は過剰、per-IP は共有 IP 誤爆リスク）／M-8（規模的に性能影響なし）／M-9（S3 障害の 404 化は運用ログ課題、将来）／M-11（設計上許容）／4b #3（spec 通り）・#4（現配線は安全、注意書き済み）／reactionCount distinct・ピン二重表示（製品判断）・バンドル分割・request-id ヘッダ・その他 cosmetic。

## 6. テスト・検証方針

- 各修正に回帰テスト（サーバーは Testcontainers 実 DB、web は RTL）。TDD（RED→GREEN）。
- 仕上げに `pnpm run verify` 全緑 + **E2E フルスイート**（`e2e:down && e2e:up && e2e`）全緑。4c-1 で張った安全網の初仕事。
- production fail-fast は loadConfig 単体テストで固定（実際に production 起動はしない）。

## 7. 完了基準

1. A/B 全 8 項目が実装・テスト済み
2. `pnpm run verify` exit 0・E2E 10/10 green
3. C 群の記録が台帳にあり、README の 4c-2 が [x]
