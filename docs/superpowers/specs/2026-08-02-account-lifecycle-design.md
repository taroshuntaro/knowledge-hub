# アカウントライフサイクル管理 設計書

日付: 2026-08-02
ステータス: 承認待ち

## 1. 目的・背景

アカウントの入口を「事前許可制」に統一し、一括での登録・無効化を可能にする。

- 現状の課題:
  - OIDC は JIT プロビジョニングのため、許可ドメインのメールを持つ人なら誰でも初回 SSO でアカウントが作られる（個人単位の事前許可ができない）。
  - パスワード認証のアカウント作成は個別のメール招待のみで、一括登録できず、メール基盤（SMTP）が前提になる。
  - 退職者の無効化は管理画面での個別操作のみ。
- 要件（ユーザー確定事項）:
  - OIDC・パスワード認証のどちらの構成でも「**事前に登録（許可）されたメールアドレスのユーザーのみログイン可能**」にする。
  - 一括登録・一括管理ができること（CSV は手段。既存の CSV 基盤を流用）。
  - **メール基盤なしで成立すること**（メールが使えなくても全フローが完結する）。
  - 同一ユーザーが両方式を併用できる必要はない（現行の「ユーザーごとに authProvider は一方」を維持）。

## 2. 全体像（確定した方式）

- **事前作成ユーザー方式**: 管理者が users 行を先に作る（未ログイン状態 = `authProvider='pending'`）。行がなければどの方式でもログイン不可。
  - OIDC: JIT 廃止。初回 SSO ログインは「事前作成された pending 行のクレーム」になる。
  - パスワード: **共通登録コード方式**。管理者が期限付きの登録コードを 1 つ発行して全体アナウンスで配布。本人が公開のクレームページで email + コード + パスワードを入力し、pending 行をクレームして即ログイン。
- **個別メール招待フローは廃止**し、入口を「事前作成（CSV または管理画面で個別追加）+ クレーム」に一本化する。invitations テーブルも削除。
- **一括無効化**: 無効化 CSV（email 列挙）と、管理画面ユーザー一覧の複数選択の両対応。
- **未ログイン（pending）ユーザーは一般メンバーから不可視**（名簿・メンション候補・プロフィール直リンクに出さない）。管理者のユーザー一覧にのみ「未ログイン」として表示。

## 3. DB スキーマ変更

`apps/server/src/db/schema.ts` を変更し `db:generate` でマイグレーション生成（手書きしない）。

1. **`auth_provider` enum に `'pending'` を追加**。
   - 事前作成行は `authProvider='pending'`、`passwordHash=null`、`role='member'`、`isActive=true` で作成。
   - 未ログイン判定は `authProvider = 'pending'` の 1 条件。追加カラムなし。
2. **`registration_codes` テーブル新設**:
   - `id` uuid PK / `codeHash` text NOT NULL UNIQUE（SHA-256、既存 `hashToken` を流用）/ `expiresAt` timestamptz NOT NULL / `revokedAt` timestamptz NULL / `createdAt` timestamptz NOT NULL default now()
   - 有効なコード = `revokedAt IS NULL AND expiresAt > now()`。**有効コードは常に最大 1 つ**（発行トランザクション内で既存有効コードを全て失効させてから insert）。
3. **`invitations` テーブル削除**（招待フロー廃止に伴う）。

`SessionUser.authProvider`（packages/shared）は `'oidc' | 'password'` の**まま維持**する。pending ユーザーはあらゆるログイン経路で拒否されセッションを持ち得ないため。`toSessionUser` 呼び出し箇所はクレーム確定後の行のみを渡す（型の絞り込みで担保）。

## 4. 登録コード

- **発行**: 管理画面から。`randomBytes` 由来の推測不能なコード（`XXXX-XXXX-XXXX-XXXX` 形式、コピー用）。**平文は発行時に 1 回だけ表示**し、DB にはハッシュのみ保存。期限は発行時に選択（7 / 30 / 90 日、デフォルト 30 日）。
- **失効**: 管理画面から手動失効。新規発行時は旧コードを自動失効。
- **表示**: 有効コードのメタデータ（発行日時・期限）のみ常時表示。平文を忘れた場合は再発行で対応。

## 5. アカウントクレームフロー

### 5.1 パスワード認証（登録コード）

- 公開ページ `/claim` を新設（`PASSWORD_AUTH_ENABLED=true` のときのみ。ログインページに「初めてご利用の方（登録コードをお持ちの方）」リンク）。
- フォーム: メールアドレス + 登録コード + パスワード（表示名は求めない。CSV/個別追加時に設定済みの表示名を使い、本人は後から設定画面で変更可能）。
- `POST /api/auth/claim`（公開、`requirePasswordAuth` ゲート、レートリミット付き）:
  1. 有効な登録コードとハッシュ照合。
  2. トランザクション内で条件付き UPDATE によるアトミッククレーム:
     `UPDATE users SET authProvider='password', passwordHash=<hash> WHERE email=<正規化済み email> AND authProvider='pending' AND isActive RETURNING *`
     （招待受諾で実績のある M-3 パターン。並行二重クレームの 2 本目は 0 行で失敗）
  3. 成功時はセッション作成して自動ログイン（旧招待受諾と同じ体験）。
- **失敗はすべて同一メッセージ**「登録コードまたはメールアドレスが正しくありません」（コード不正 / 期限切れ / 該当 email なし / クレーム済み / 無効化済み、を区別しない。アカウント列挙・状態漏洩防止）。エラーコードは `CLAIM_INVALID`。
- レートリミット: 既存 `rate-limiter` を流用し、ログインと同等の制限をかける（コード総当たり・email 探索対策）。

### 5.2 OIDC（SSO クレーム）

`oidc-service.ts` の `upsertByEmail` を変更（変更はこの 1 箇所に閉じる）:

- 該当 email の行が **pending** → `authProvider='oidc'` に確定してクレーム（isActive=false は既存どおり `OIDC_INACTIVE` で拒否）。表示名は事前作成時の値を維持。
- 行が**ない** → JIT 作成せず拒否。新コード `OIDC_NOT_PROVISIONED`「このメールアドレスは登録されていません。管理者にお問い合わせください」(403)。
- 既存 **password** 行 → 現行の自動リンク動作を維持（`email_verified=true` のみ、SSO 専用化）。既存行 = 事前許可済みなので要件と整合。
- 既存 **oidc** 行 → 現行どおりログイン。
- `OIDC_ALLOWED_EMAIL_DOMAINS` は**追加の防御層として存置**（ドメイン検査 → 行の有無、の順で両方通過が必要）。

## 6. 一括登録（CSV）と個別追加

### 6.1 登録 CSV

- ヘッダー: `email,display_name,department,position,hire_year`
- `email`・`display_name` は必須。`department` / `position` / `hire_year` は任意（空欄 = 未設定）。未知の所属・役職はマスタへ自動登録（既存 `ensureDepartments` / `ensurePositions` を流用）。
- **既存 email（状態を問わず）は行エラー**「このメールアドレスは既に登録されています」。登録 CSV は追加専用（組織情報の更新は既存の org CSV を使う）。
- all-or-nothing・単一トランザクション・行番号付きエラー報告（既存 `user-import-service` / `parseCsv` の流儀を踏襲）。5MB bodyLimit。
- 作成される行: `authProvider='pending'` / `role='member'` 固定（admin 昇格は既存の個別操作のみ。CSV で権限を作らせない）。
- 結果: 作成件数 + 自動登録されたマスタ名。

### 6.2 個別追加

- 管理画面のユーザー一覧に「ユーザーを追加」フォーム（email・表示名・所属・役職・入社年）。
- `POST /api/admin/users`。登録 CSV と同じサービス経路・同じ検証（1 件版）。旧「招待」ボタンの置き換え。

## 7. 一括無効化

- **サービス層は 1 本**: 対象 user id 群を受け取り、トランザクションで検証 → `isActive=false` → 全対象のセッション削除。
  - **最後の管理者ガードをバッチ全体で適用**: 実行後にアクティブ管理者が 0 になるバッチは全体を `LAST_ADMIN` で拒否（既存の FOR UPDATE パターンを踏襲）。
  - **「アクティブ管理者」の定義を全ガードで統一**: `role='admin' AND isActive AND authProvider != 'pending'`（ログイン可能な管理者）。既存 `updateUserByAdmin` のガードも同条件に更新する（pending の管理者を数えると、ログイン可能な管理者が 0 になる穴ができる）。
  - **既に無効のユーザーは no-op として受理**（冪等。同じ CSV の再実行がエラーにならない）。
- **CSV**: ヘッダー `email` のみ。存在しない email は行エラー（all-or-nothing）。`POST /api/admin/users/deactivate/import`。
- **UI 複数選択**: 管理画面ユーザー一覧にチェックボックス + 「選択したユーザーを無効化」（確認ダイアログ付き）。`POST /api/admin/users/deactivate` `{ userIds: [...] }`。
- 個別の有効化/無効化トグル（既存 PATCH）は残す。

## 8. 未ログイン（pending）ユーザーの可視性と管理操作

- **一般側から不可視**:
  - メンション候補（`listMentionCandidates`）から除外。
  - 名簿 `GET /api/profiles` から除外。
  - プロフィール `GET /api/users/:id` は 404。
- **管理者のユーザー一覧**では「未ログイン」バッジで表示（authProvider 列で判定）。
- **pending 行の削除**: `DELETE /api/admin/users/:id`。`authProvider='pending'` の行のみ許可（未ログインなので記事・コメント等の被参照が存在せず安全にハード削除できる）。クレーム済みユーザーは 409。誤登録の取り消し用。
- **未ログインに戻す（クレーム取り消し）**: `POST /api/admin/users/:id/unclaim`。`authProvider='pending'` に戻し、`passwordHash=null`、セッション全削除。対象が既に pending の場合は 409（削除ガードと対称）。用途:
  - 共通コードの弱点である「他人の email での誤クレーム / なりすまし」からの復旧。
  - **メールなし環境でのパスワードリセット代替**（本人が管理者に依頼 → unclaim → 有効なコードで再クレーム）。
  - 対象が最後のアクティブ管理者（§7 の統一定義）の場合は `LAST_ADMIN` で拒否（ログイン可能な管理者が 0 になるのを防ぐ）。
  - 確認ダイアログで「このユーザーは再クレームまでログインできず、名簿に表示されなくなります（記事等のコンテンツは残ります）」と明示。

## 9. 廃止・削除するもの

- 招待系 API（発行・受諾）、`invitation-service.ts`、`invitations` テーブル、Web の `InvitePage` と `/invite/:token` ルート、管理画面の招待 UI。
- OIDC の JIT 自動作成（`upsertByEmail` の insert 分岐）。
- Mailer は**パスワードリセットメール専用**として残る（メールなし環境のリセットは unclaim + 再クレームで代替）。

## 10. API 変更一覧（docs/api.md 追従）

追加:

| メソッド/パス | 認可 | 概要 |
|---|---|---|
| POST /api/auth/claim | 公開（password 構成時のみ・RL 付き） | 登録コードで pending 行をクレームし自動ログイン |
| GET /api/admin/registration-code | admin | 有効コードのメタデータ取得 |
| POST /api/admin/registration-code | admin | 発行（旧コード自動失効・平文は応答 1 回のみ） |
| DELETE /api/admin/registration-code | admin | 失効 |
| POST /api/admin/users | admin | 個別事前作成 |
| POST /api/admin/users/import | admin | 登録 CSV 一括作成 |
| POST /api/admin/users/deactivate | admin | userIds 指定の一括無効化 |
| POST /api/admin/users/deactivate/import | admin | 無効化 CSV |
| DELETE /api/admin/users/:id | admin | pending 行の削除 |
| POST /api/admin/users/:id/unclaim | admin | 未ログインに戻す |

削除: 招待系エンドポイント一式。
変更: OIDC callback の拒否条件（`OIDC_NOT_PROVISIONED` 追加・JIT 廃止）。

エラーコード追加（packages/shared `ERROR_CODES`）: `CLAIM_INVALID` / `OIDC_NOT_PROVISIONED`。

## 11. 画面変更（docs/screens.md 追従）

- **/claim（新設・公開）**: email + 登録コード + パスワードでアカウント有効化。成功で自動ログイン → フィードへ。
- **/login**: クレームページへのリンク追加（password 構成時のみ）。
- **/invite/:token**: 削除。
- **/admin（ユーザー管理）**: 登録コード管理セクション（発行・失効・メタ表示）／「ユーザーを追加」フォーム／CSV インポート 2 種（登録・無効化。既存の org CSV UI の流儀）／一覧にチェックボックスと一括無効化／「未ログイン」バッジ／pending 削除・unclaim 操作。

## 12. セキュリティ考慮

- **共通コードの受容リスクと緩和**: コードを知る者（社内想定）が他人の未クレーム email で先に登録できる。緩和策: 期限付き・手動失効・レートリミット・管理者一覧でクレーム状況を監査可能・`unclaim` による復旧。個別リンク方式より配布負荷を優先するユーザー判断（2026-08-02）。
- クレーム失敗の**応答統一**（コード/email/状態を区別しない）でアカウント列挙を防ぐ。
- コードは**ハッシュ保存**・平文非永続化・ログ非出力（既存の秘密情報ポリシー準拠）。
- クレームは**条件付き UPDATE でアトミック**（並行二重クレーム防止）。
- 登録 CSV は `role='member'` 固定（一括経路からの権限付与を不可能に）。
- `PASSWORD_AUTH_ENABLED=false` では claim API・ページとも無効（OIDC 専用構成でコード経路が開かない）。

## 13. テスト戦略

- **サービス（Testcontainers・実 PostgreSQL)**:
  - 登録コード: 発行で旧コード失効・期限切れ/失効/不一致の拒否。
  - クレーム: 成功・自動ログイン・失敗 5 態様が同一エラー・**並行二重クレームで片方 0 行**。
  - OIDC: pending クレーム成功／行なし拒否（`OIDC_NOT_PROVISIONED`）／password 自動リンク・oidc 再ログインの既存挙動が不変（回帰）。
  - 登録 CSV: all-or-nothing・既存 email 行エラー・マスタ自動登録・`role`/`authProvider` 固定。
  - 一括無効化: バッチの最後の管理者ガード・冪等（無効済み no-op）・セッション失効。
  - 可視性: メンション候補・profiles・users/:id の pending 除外。
  - pending 削除ガード・unclaim（最後の管理者拒否含む）。
- **Web**: クレームページ（成功/失敗表示）・管理画面の追加 UI（既存テストの流儀）。
- **E2E**: **setup の member 作成を「招待 + Mailpit」から「管理者による事前作成 + 登録コードクレーム」に書き換え**（クレームフローの E2E を兼ねる。E2E のメール依存が消える）。無効化 → ログイン拒否の既存シナリオは維持。**sso.spec も要修正**: JIT 廃止により、Keycloak 側テストユーザー（sso-taro@example.com）の pending 行をアプリ側に事前作成してから SSO ログインする流れに変更（「行なしで SSO → 拒否」の負テストも追加候補）。

## 14. スコープ外（今回はやらない）

- 人事システム連携・SCIM・在籍者 CSV との全量同期（差分検出による自動無効化）。
- 個別招待リンクの発行・配布（共通コードで代替。必要になったら再検討）。
- pending ユーザーの名簿表示オプション。
- 登録 CSV と org CSV の統合（列が重複するが、追加専用/更新専用で責務が異なるため別のまま）。
- アカウントの完全削除（クレーム済みユーザー。無効化で代替）。

## 15. 実装メモ

- 影響箇所の検証結果（2026-08-02 コード確認済み）:
  - ログイン境界は既に `authProvider==='password'`（auth-service）/ `'oidc'`（changePassword・password-reset）でゲート済みで、pending は自然に拒否される。
  - `SessionUser` 型は不変で維持可能。
  - E2E setup（tests/e2e）は招待フロー依存のため書き換え必須。
  - `docs/api.md` / `docs/screens.md` は同一変更セットで追従（AGENTS.md 準拠）。
