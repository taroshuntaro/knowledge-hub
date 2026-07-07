# Phase 4b: OIDC 汎用ログイン 設計書

2026-07-07 承認。全体設計書 `2026-07-04-knowledge-hub-design.md` §5 の「OIDC 汎用」を実装する。

## 1. ゴールとスコープ

任意の OIDC IdP（Google / Entra ID / Keycloak 等）に issuer / client ID / secret の環境変数だけで接続し、初回ログインで member を自動作成（JIT プロビジョニング）する。既存のパスワード認証・DB セッションはそのまま共存し、`PASSWORD_AUTH_ENABLED=false` で OIDC 専用運用にできる。

**スコープ外（YAGNI、全体設計書どおり）:**
- OIDC クレームによる admin 昇格（クレームマッピング）— 昇格は管理画面から
- RP-Initiated Logout（ログアウトはローカルセッション削除のみ。IdP セッションは切らない）
- リフレッシュトークン（自前 DB セッションが正。IdP トークンはログイン完了後に破棄）
- 複数 IdP 同時接続

## 2. 方式（決定: 案 A）

**`openid-client`（OpenID Foundation 認定ライブラリ、v6 系）+ Authorization Code + PKCE。**
ディスカバリ・PKCE・ID トークン検証（署名 / iss / aud / exp / nonce）をすべてライブラリに委譲し、セキュリティクリティカルな検証コードを自作しない。

不採用: 自作（fetch + jose）はトークン検証の自前実装がリスク／`@hono/oidc-auth` は独自セッション管理が既存 DB セッションモデル・JIT リンク処理と競合。

## 3. 設定（config.ts 拡張）

| 環境変数 | 意味 |
|---|---|
| `OIDC_ISSUER` | IdP の issuer URL（例 `https://accounts.google.com`） |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | クライアント資格情報 |
| `OIDC_ALLOWED_EMAIL_DOMAINS` | JIT を許可するメールドメイン（カンマ区切り）。**未設定 = 全ドメイン許可** |

- OIDC は **3 変数（issuer/clientId/clientSecret）が揃ったときのみ有効**。一部だけ設定されている場合は起動時エラー（fail-fast、設定ミスの黙殺防止）
- `PASSWORD_AUTH_ENABLED=false` かつ OIDC 無効の場合も起動時エラー（ログイン手段ゼロの防止）
- `Config` 型には `oidc?: { issuer, clientId, clientSecret, allowedEmailDomains: string[] }` として畳み込む（`undefined` = 無効）
- `.env.example` にコメント付きで追記（値は Keycloak dev 用のダミー）

## 4. フロー

新規ファイル: `apps/server/src/services/oidc-service.ts`（プロトコル + JIT ロジック）、`apps/server/src/routes/auth-oidc.ts`（ルート）。既存 `auth.ts` は methods エンドポイント追加のみ。

### 4.1 `GET /api/auth/oidc/login`
1. OIDC 無効なら 404
2. `state` / `nonce` / PKCE `code_verifier` を生成
3. 3 値を **短命（10 分）httpOnly / SameSite=Lax Cookie**（名前 `oidc_txn`、JSON を base64url 化）に保存
4. IdP の authorization endpoint へ 302（scope: `openid email profile`）

### 4.2 `GET /api/auth/oidc/callback`
1. `oidc_txn` Cookie を読み取り、**成否に関わらず直ちに削除**（一度きり保証）。不在・不正 → `/login?error=oidc_failed` へ 302
2. `openid-client` の code 交換で ID トークン検証（state / nonce / PKCE はライブラリに渡して照合）
3. claims 検証（§5）→ JIT / リンク（§5）→ 既存 `createSession` + `setSessionCookie` → `APP_URL` へ 302
4. 失敗は種別ごとに `/login?error=<code>` へ 302: `oidc_failed`（プロトコル/検証エラー）/ `oidc_domain`（ドメイン不許可）/ `oidc_inactive`（無効化ユーザー）/ `oidc_email`（email claim 欠落 or email_verified=false）
5. コールバックへの直接アクセス・リプレイは state 照合と一度きりの Cookie 削除で拒否される

### 4.3 ディスカバリの初期化
IdP ディスカバリ（`.well-known/openid-configuration` 取得）は**初回ログイン試行時に遅延実行しメモ化**。失敗時はメモ化せず `AppError('OIDC_UNAVAILABLE', ..., 503)` を投げ（次回再試行）、ルート側で捕捉して `/login?error=oidc_unavailable` へ 302 する（`/api/auth/oidc/login` もブラウザナビゲーションのため JSON を返さない。§9 と同方針）。IdP 停止がアプリ起動を妨げない。dev/test の http issuer には `allowInsecureRequests` を許可（`nodeEnv !== 'production'` のときのみ）。

### 4.4 ログ
既存の構造化ログ方針を踏襲: ログイン成功/失敗は userId・理由コードのみ。**トークン・claims 生値・email はログしない**（request-logger は routePath ベースで query の code/state も記録されないことを確認済みだが、サービス側でも生値を渡さない）。

## 5. JIT プロビジョニング / 自動リンク（ユーザー決定反映）

callback で得た claims を次の順で処理する（`oidc-service.ts` 内、1 トランザクション）:

1. **email 必須**: email claim なし、または `email_verified === false` → 拒否（`oidc_email`）。`email_verified` が未提供（undefined）の IdP は許容
2. **ドメイン制限**: `OIDC_ALLOWED_EMAIL_DOMAINS` 設定時、email のドメイン（大文字小文字無視）が含まれなければ拒否（`oidc_domain`）。**既存ユーザーへのログインにも適用**（許可リストを後から絞った場合に旧ドメインを締め出せる）
3. **既存ユーザー検索**（**大文字小文字を無視した email 一致**: `lower(users.email) = lower(claims.email)`。IdP が `User@example.com` のような表記を返しても重複アカウントを作らない。JIT 新規作成時は email を小文字化して保存）:
   - `isActive=false` → 拒否（`oidc_inactive`）。コンテンツは保全済みの無効化ユーザーを SSO で復活させない
   - `authProvider='password'` → **自動リンク**: `authProvider='oidc'` に更新し `passwordHash=null`。以降パスワードログイン（既存の provider チェックで拒否）・パスワードリセット（同）・パスワード変更（§6）は不可 = SSO 専用化。記事・コメント等の所有は不変
   - `authProvider='oidc'` → そのままログイン
4. **新規作成**: `role='member'`, `authProvider='oidc'`, `passwordHash=null`, `displayName` = `name` claim（なければ email のローカル部）。並行初回ログインの email 一意制約違反（23505）は捕捉して既存行を再取得しリンク（500 にしない）
5. セッション作成（既存 `createSession`）

**IdP の `sub` は保存しない（V1 判断）**: ユーザーの同一性は email で解決する。社内 IdP で email は安定・一意である前提（全体設計書の運用想定）。`sub` カラム追加は IdP 移行・email 変更対応が必要になった時点で行う。

## 6. 既存認証との整合（確認済みの現状 + 変更点）

| 経路 | 現状 | 変更 |
|---|---|---|
| パスワードログイン | `authProvider==='password'` チェック済み（auth-service.ts） | 変更なし（リンク後は自動的に拒否） |
| パスワードリセット要求 | `authProvider='password'` フィルタ済み（列挙非漏洩のまま無送信） | 変更なし |
| パスワード変更 | `passwordHash` 照合のみ | `authProvider='oidc'` なら 400（明示メッセージ）。リンク時に hash は null 化済みだが防御的に明示 |
| 招待 | 既存ユーザーと email 重複時は accept で EMAIL_TAKEN 409 | 変更なし（JIT 済みユーザーへの招待は accept 時に自然に拒否される） |
| セッション / requireAuth | provider 非依存 | 変更なし |
| 管理画面ユーザー一覧 | `authProvider` 表示済み | 変更なし |

## 7. Web（LoginPage / SettingsPage）

- **`GET /api/auth/methods`（公開・認証不要）**: `{ password: boolean, oidc: boolean }`。LoginPage が起動時に取得
- LoginPage: `oidc: true` なら「SSO でログイン」ボタン（`/api/auth/oidc/login` への通常リンク遷移）。`password: false` ならメール/パスワードフォームを出さない。両方有効なら区切り線で併記
- callback エラー: `/login?error=<code>` の query を日本語メッセージにマップして既存のエラー表示枠に出す（`oidc_domain` = 「このメールドメインは許可されていません」等）
- **SessionUser に `authProvider` を追加**（shared 型 + `toSessionUser`）: SettingsPage は `authProvider==='oidc'` のときパスワード変更フォームを非表示（サーバー側 400 と二重防御）

## 8. テスト戦略（実 IdP なし）

**テスト内モック IdP**: エフェメラルポートで listen する小さな in-process HTTP サーバー（テストヘルパー `apps/server/src/test/mock-idp.ts`）が以下を提供する:
- `/.well-known/openid-configuration`（ディスカバリ文書）
- `/jwks`（テスト起動時に生成した RSA 鍵の公開鍵）
- `/token`（authorization code を受けて `jose` で**実署名**した ID トークンを返す。nonce エコーバック、claims はテストごとに注入可能）
- `/authorize` はブラウザ相当をテストコードが代行（redirect_uri に code+state を付けて callback を直接叩く）

これにより openid-client の**署名検証を含む本物のコードパス**を Testcontainers 実 DB と組み合わせて検証する。openid-client をモックしない。

**必須テストケース**: JIT 新規作成（member/displayName フォールバック）／自動リンク（authProvider 切替 + passwordHash null 化 + 以降のパスワードログイン拒否）／oidc 既存ユーザー再ログイン／無効ユーザー拒否／ドメイン拒否（既存ユーザー含む）／email_verified=false 拒否／email claim 欠落拒否／state 不一致・txn Cookie 欠落拒否／並行 JIT の一意制約フォールバック／methods エンドポイント（設定有無 × 4 通り）／changePassword の oidc 拒否／IdP 到達不能で `/login?error=oidc_unavailable` へ 302（500 にしない）。

**手動検証（コントローラー実施）**: docker compose に Keycloak を **profile `idp`** で追加（普段の `up -d` では起動しない）。realm JSON 自動インポート（client `knowledge-hub`、redirect URI `http://localhost:5173/api/auth/oidc/callback`、テストユーザー 1 名）。ブラウザで SSO ボタン → Keycloak ログイン → JIT 作成 → フィード到達を通しで確認。

## 9. エラーハンドリング方針

- callback は**ブラウザの通常ナビゲーション**なので JSON エラーではなく必ず `/login?error=<code>` へ 302（JSON を返すと白画面になる）
- `oidc_txn` Cookie は callback 処理の最初に削除（成功・失敗問わず一度きり）
- 想定外の例外は既存 errorHandler に到達させず catch して `oidc_failed` に落とす（トークン交換の例外メッセージに機微情報が含まれうるため、詳細は logger.warn のみ）
