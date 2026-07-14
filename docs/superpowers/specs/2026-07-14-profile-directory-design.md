# プロフィール一覧（メンバー名簿）設計

- 日付: 2026-07-14
- ステータス: 承認済み（設計）

## 目的

社員のプロフィール一覧ページを提供する。表示名での検索、所属・役職・入社年での絞り込み、
名前・所属・役職・入社年での並び替えができる。所属・役職・入社年は管理者のみが設定でき、
本人は編集できない。運用の現実性のため、CSV による一括設定を提供する。

## 決定事項（経緯）

| 論点 | 決定 | 理由 |
| --- | --- | --- |
| データの管理者 | 管理者のみ編集（本人編集不可） | 人事情報としての正確性を担保 |
| 所属・役職の形式 | マスタテーブル管理（選択式） | 表記ゆれ防止。`sortOrder` により役職順（部長→課長→…）の並び替えを表現できる |
| 一括設定 | CSV インポート + 管理画面での個別編集 | 現実的な運用（人事データの流し込み）に対応 |
| 入社時期の粒度 | 年のみ（integer） | 要件は「入社年での絞り込み」。最小で足りる |
| 検索・絞り込み・並び替えの実行場所 | クライアントサイド | 既存 `GET /api/users`（メンション候補）が全件返却する前例あり。名簿規模（数百人）なら全件取得 + 即時フィルタが UX・実装とも優位。千人規模になったらサーバーサイド化を検討 |
| CSV の適用単位 | all-or-nothing | 1 行でもエラーなら何も適用しない。修正して再投入する予測可能な運用 |
| マスタ削除時の割当 | `ON DELETE SET NULL` | 誤削除しても CSV 再投入で復旧容易。削除ブロックより運用が軽い |

## データモデル

`apps/server/src/db/schema.ts` に追加し、`db:generate` でマイグレーションを生成する（手書きしない）。

```
departments:
  id         uuid PK defaultRandom
  name       text NOT NULL UNIQUE
  sortOrder  integer NOT NULL DEFAULT 0
  createdAt  timestamptz NOT NULL DEFAULT now()

positions:   （departments と同形）
```

`users` への追加カラム（すべて nullable — 未設定ユーザーを許容）:

```
departmentId  uuid REFERENCES departments(id) ON DELETE SET NULL
positionId    uuid REFERENCES positions(id) ON DELETE SET NULL
hireYear      integer   -- 検証範囲: 1950 〜 現在年 + 1（内定者の事前登録を許容）
```

## API

契約（リクエスト / レスポンスの Zod スキーマ、ERROR_CODES）は `packages/shared` に集約する。

### 一般ユーザー向け

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/profiles` | 🔒 ログイン | プロフィール一覧（全件） + マスタ一覧 |

`GET /api/profiles` レスポンス（1 リクエストでページ全体を賄う）:

```jsonc
{
  "users": [{
    "id": "...", "displayName": "...", "avatarUrl": null, "bio": "...",
    "department": { "id": "...", "name": "開発部" },   // または null
    "position":   { "id": "...", "name": "課長" },     // または null
    "hireYear": 2020                                    // または null
  }],
  "departments": [{ "id": "...", "name": "...", "sortOrder": 0 }],
  "positions":   [{ "id": "...", "name": "...", "sortOrder": 0 }]
}
```

- 対象は `isActive = true` のユーザーのみ（無効化済みユーザーは含めない）。
- `departments` / `positions` は絞り込み候補と並び順定義のために全件（未割当含む）を `sortOrder` 順で返す。
- 実装は新規 `routes/profiles.ts` を `/api/profiles` にマウント、`requireAuth` を適用。

また、既存 `GET /api/users/:id`（公開プロフィール）のレスポンスに
`department` / `position` / `hireYear` を追加する（ProfilePage での表示用）。

### 管理者向け

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/admin/departments` | 🛡️ 管理者 | 所属一覧（sortOrder 順） |
| POST | `/api/admin/departments` | 🛡️ 管理者 | 所属を作成（name 重複は 409） |
| PATCH | `/api/admin/departments/:id` | 🛡️ 管理者 | name / sortOrder を更新 |
| DELETE | `/api/admin/departments/:id` | 🛡️ 管理者 | 所属を削除（割当ユーザーは null に戻る） |
| GET/POST/PATCH/DELETE | `/api/admin/positions`（同形 4 本） | 🛡️ 管理者 | 役職マスタの CRUD |
| POST | `/api/admin/users/import` | 🛡️ 管理者 | CSV 一括設定（multipart/form-data） |

既存 API の変更:

- `PATCH /api/admin/users/:id`（`updateUserByAdminSchema`）に
  `departmentId` / `positionId` / `hireYear` を追加。
  本人編集用の `updateProfileSchema`（`PATCH /api/users/me`）には **追加しない**。
- `GET /api/admin/users` のレスポンスに所属・役職・入社年を追加（管理画面での現在値表示用）。

パス上の `:id` は `routes/guards.ts` の `requireUuidParam` で検証する。

## CSV インポート仕様

- エンドポイント: `POST /api/admin/users/import`、multipart/form-data の `file` フィールド。
- 形式: UTF-8（BOM 許容）、RFC 4180 準拠（カンマ・改行を含む値はダブルクォート）。
- ヘッダー行必須: `email,department,position,hire_year`（この 4 列・この順）。
- 各行の意味:
  - `email` をキーに該当ユーザーを更新する。email は `normalizeEmail`（trim + 小文字化）で
    正準化して照合する。
  - `department` / `position` / `hire_year` の **空欄はクリア（null 設定）**。
    CSV は「記載したユーザーの正」として扱う。
  - CSV に **載っていないユーザーは変更しない**。
  - 未知の所属・役職名はマスタへ自動登録する（trim 後の完全一致で照合、
    `sortOrder` は既存の最大値 + 1 で末尾に追加）。
- all-or-nothing: 全行をバリデーションし、1 件でもエラーがあれば **何も適用せず** 400 を返す。
  エラー例: 存在しないメールアドレス、hire_year が整数でない / 範囲外、ヘッダー不正、列数不一致、
  同一メールの重複行。レスポンスは ApiError 形式のエラー一覧
  `{ code: 'CSV_IMPORT_FAILED', message, details: [{ line, email?, message }] }`。
- 成功時 200: `{ updated: number, createdDepartments: string[], createdPositions: string[] }`。
- 適用は単一トランザクションで行う。

## 画面

### `/members` — メンバー一覧（新規、🔒 ログイン）

- 新規 `pages/ProfilesPage.tsx`。`RequireAuth` 配下の通常ルート。Layout のナビに「メンバー」リンクを追加。
- 検索: 表示名の部分一致（大文字小文字無視）。入力即時反映（クライアントサイド）。
- 絞り込み: 所属 / 役職 / 入社年の 3 セレクト、AND 条件。
  入社年の候補は取得データに存在する年から降順で生成。
- 並び替え: 名前（既定）/ 所属 / 役職 / 入社年。
  - 所属・役職: マスタの `sortOrder` 順 → 同一グループ内は名前順。未設定ユーザーは末尾。
  - 入社年: 昇順 / 降順の切替可。未設定は末尾。
  - 名前: ロケール比較（`localeCompare('ja')`）。
- 表示: カードグリッド。アバター・表示名・所属 / 役職・入社年・bio 抜粋。
  クリックで既存の `/users/:id`（ProfilePage）へ遷移。
- データ取得は `hc<AppType>` クライアント + 専用フック（`api/` 配下）。
  エラーは `lib/api-error.ts` の `errorMessage` / `NETWORK_ERROR_MESSAGE` を使う。

### `/admin/masters` — 所属・役職マスタ管理（新規、🛡️ 管理者）

- 新規 `pages/AdminMastersPage.tsx`。AdminCategoriesPage と同パターン。
- 所属・役職それぞれの一覧（sortOrder 順）、追加・名称変更・並び順変更・削除。
- 削除時は「割当済みユーザーは未設定に戻る」旨を確認ダイアログで明示。

### 既存画面の変更

- **AdminUsersPage（/admin）:** 一覧に所属・役職・入社年の列を追加。
  個別編集（所属・役職はマスタからのセレクト、入社年は数値入力）。
  CSV アップロード UI（ファイル選択 → 実行 → 結果 / 行番号付きエラー表示）。
- **ProfilePage（/users/:id）:** 所属・役職・入社年を表示（未設定は非表示）。
- **SettingsPage:** 変更なし（本人は編集できない）。

## エラーハンドリング

- サーバーは `AppError(code, message, status)` を投げ、`error-handler` が整形する既存方式。
- 追加する ERROR_CODES（`packages/shared`）: マスタ name 重複（409）、CSV バリデーション失敗（400）。
- Web は非 2xx を `errorMessage(res, fallback)` で表示。文言ベタ書きしない。

## テスト

- **サービス層（Testcontainers、実 PostgreSQL）:**
  - マスタ CRUD（重複 409、削除時の SET NULL）
  - profiles 一覧（isActive=false の除外、department/position の JOIN 形）
  - CSV インポート: 正常系（更新・クリア・マスタ自動登録）、エラー系（未知メール、
    範囲外 hire_year、ヘッダー不正、重複行）、all-or-nothing（一部エラー時に何も変わらない）
- **Web（併置 `*.test.tsx`）:** ProfilesPage の検索・絞り込み・並び替え、
  AdminMastersPage の CRUD 操作、AdminUsersPage の CSV 結果表示。
- **E2E（Playwright）:** ログイン → /members → 絞り込み → プロフィール遷移の 1 シナリオ。

## ドキュメント追従

同一変更セットで更新する:

- `docs/screens.md`: `/members`、`/admin/masters` を追加（キャプチャのプレースホルダー行含む）。
  AdminUsersPage の機能追記。
- `docs/api.md`: `/api/profiles`、マスタ CRUD 8 本、`/api/admin/users/import`、
  既存エンドポイントのレスポンス変更を追記。

## スコープ外（今回はやらない）

- 管理者によるアカウントの事前作成（現状は招待フローのみ。別機能として検討）。
  将来要件として、新入社員の CSV 一括登録（事前登録 → 本人ログイン）と退職者の一括無効化が
  挙がっている（2026-07-14）。今回の CSV 基盤（パーサ・all-or-nothing 検証・エラー報告 UI）は
  流用可能で、本設計はこれを妨げない。仮パスワード or 招待メール自動送付の選択が将来の論点。
- サーバーサイドの検索・ページング（千人規模になったら再検討）
- 入社年月日・勤続年数表示
- 所属の階層構造（部 > 課）
