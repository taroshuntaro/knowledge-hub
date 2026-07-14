# API 一覧

knowledge-hub のサーバー（Hono）が公開する HTTP エンドポイントの一覧。プロジェクト全体を素早く把握するためのリファレンス。画面側の一覧は [`screens.md`](./screens.md) を参照。

- ルートの組み立ては [`apps/server/src/app.ts`](../apps/server/src/app.ts)、各ルートは `apps/server/src/routes/`。
- リクエスト / レスポンスの形と `ERROR_CODES` は `packages/shared` の Zod スキーマが唯一の正。Web は `hc<AppType>` の型推論で end-to-end に型が通る。
- 認証は**セッションクッキー**。非 2xx のレスポンス本文には `ERROR_CODES` に基づくエラーコードが入る。

## 凡例（認可）

| 記号 | 意味 | 実装 |
| --- | --- | --- |
| 🌐 公開 | 認証不要 | ミドルウェアなし |
| 🔒 ログイン | ログイン必須 | `requireAuth`（セッション） |
| 🛡️ 管理者 | 管理者権限が必要 | `requireCan('user:manage' \| 'category:manage')` |

> パスワード関連のエンドポイント（`login` / `password-reset`）には `requirePasswordAuth` が付き、**パスワード認証が有効な構成でのみ**利用できる（OIDC のみの構成では無効）。以下の表では「🌐 公開（要 password 認証）」と表記する。

---

## ヘルスチェック

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/healthz` | 🌐 公開 | DB 疎通確認を含むヘルスチェック |

## 認証 `/api/auth`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/auth/methods` | 🌐 公開 | 有効な認証方式（password / oidc）を返す |
| POST | `/api/auth/login` | 🌐 公開（要 password 認証） | パスワードでログインしセッションを発行 |
| POST | `/api/auth/logout` | 🌐 公開 | セッションを破棄しログアウト |
| GET | `/api/auth/me` | 🔒 ログイン | 現在ログイン中のユーザーを返す |
| POST | `/api/auth/invitations/:token/accept` | 🌐 公開 | 招待トークンを受諾しアカウント作成 + ログイン |
| POST | `/api/auth/password-reset/request` | 🌐 公開（要 password 認証） | 再設定リンクをメール送信 |
| POST | `/api/auth/password-reset/confirm/:token` | 🌐 公開（要 password 認証） | トークンで新パスワードを確定 |

## OIDC 認証 `/api/auth/oidc`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/auth/oidc/login` | 🌐 公開 | OIDC 認可リクエストを開始（IdP へリダイレクト） |
| GET | `/api/auth/oidc/callback` | 🌐 公開 | IdP からのコールバックを受けセッションを発行 |

## ユーザー `/api/users`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/users` | 🔒 ログイン | メンション候補となるユーザー一覧 |
| PATCH | `/api/users/me` | 🔒 ログイン | 自分のプロフィールを更新 |
| POST | `/api/users/me/password` | 🔒 ログイン | 自分のパスワードを変更（セッション再発行） |
| GET | `/api/users/:id` | 🔒 ログイン | 指定ユーザーの公開プロフィール（所属・役職・入社年を含む） |
| GET | `/api/users/:id/articles` | 🔒 ログイン | 指定ユーザーの記事一覧 |

## プロフィール一覧 `/api/profiles`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/profiles` | 🔒 ログイン | メンバー一覧（所属・役職マスタを同梱） |

## 管理 `/api/admin`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/admin/users` | 🛡️ 管理者 | 全ユーザー一覧 |
| POST | `/api/admin/users/invitations` | 🛡️ 管理者 | 招待を作成しメール送信 |
| PATCH | `/api/admin/users/:id` | 🛡️ 管理者 | ユーザーのロール・状態・所属・役職・入社年を更新 |
| POST | `/api/admin/users/import` | 🛡️ 管理者 | CSV で所属・役職・入社年を一括設定 |
| GET | `/api/admin/departments` | 🛡️ 管理者 | 所属マスタ一覧 |
| POST | `/api/admin/departments` | 🛡️ 管理者 | 所属マスタを作成 |
| PATCH | `/api/admin/departments/:id` | 🛡️ 管理者 | 所属マスタを更新（改名・並び順） |
| DELETE | `/api/admin/departments/:id` | 🛡️ 管理者 | 所属マスタを削除 |
| GET | `/api/admin/positions` | 🛡️ 管理者 | 役職マスタ一覧 |
| POST | `/api/admin/positions` | 🛡️ 管理者 | 役職マスタを作成 |
| PATCH | `/api/admin/positions/:id` | 🛡️ 管理者 | 役職マスタを更新（改名・並び順） |
| DELETE | `/api/admin/positions/:id` | 🛡️ 管理者 | 役職マスタを削除 |

## カテゴリ `/api/categories`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/categories` | 🔒 ログイン | カテゴリツリーを取得 |
| GET | `/api/categories/:id/articles` | 🔒 ログイン | カテゴリ別の記事一覧（カーソルページング） |
| POST | `/api/categories` | 🛡️ 管理者 | カテゴリを作成 |
| PATCH | `/api/categories/:id` | 🛡️ 管理者 | カテゴリを更新 |
| DELETE | `/api/categories/:id` | 🛡️ 管理者 | カテゴリを削除（所属記事を別カテゴリへ付け替え可） |

## タグ `/api/tags`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/tags/popular` | 🔒 ログイン | 人気タグの一覧 |
| GET | `/api/tags/:name/articles` | 🔒 ログイン | タグ別の記事一覧（カーソルページング） |

## 記事 `/api/articles`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| POST | `/api/articles` | 🔒 ログイン | 記事を作成（下書き） |
| GET | `/api/articles` | 🔒 ログイン | 記事フィード（カーソルページング） |
| GET | `/api/articles/pickup` | 🔒 ログイン | ピックアップ記事 |
| GET | `/api/articles/mine` | 🔒 ログイン | 自分の記事一覧（状態タブ・ページ指定） |
| GET | `/api/articles/:id` | 🔒 ログイン | 記事を取得（閲覧者に応じた可視性判定） |
| PATCH | `/api/articles/:id` | 🔒 ログイン（著者/権限） | 記事を更新 |
| POST | `/api/articles/:id/publish` | 🔒 ログイン（著者/権限） | 記事を公開 |
| POST | `/api/articles/:id/unpublish` | 🔒 ログイン（著者/権限） | 記事を非公開に戻す |
| DELETE | `/api/articles/:id` | 🔒 ログイン（著者/権限） | 記事を論理削除 |
| POST | `/api/articles/:id/restore` | 🔒 ログイン（著者/権限） | 論理削除した記事を復元 |
| DELETE | `/api/articles/:id/purge` | 🔒 ログイン（著者/権限） | 記事を完全削除 |
| POST | `/api/articles/:id/pin` | 🔒 ログイン（著者/権限） | 記事をピン留め |
| POST | `/api/articles/:id/unpin` | 🔒 ログイン（著者/権限） | ピン留めを解除 |

> 「公開かつ未削除」の判定は `services/article-visibility.ts` に一元化されており、著者本人・権限保持者は下書き/削除済みも閲覧・操作できる。

## コメント `/api/articles/:id/comments`, `/api/comments`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/articles/:id/comments` | 🔒 ログイン | 記事のコメント一覧（カーソルページング） |
| POST | `/api/articles/:id/comments` | 🔒 ログイン | コメントを投稿（メンション通知の発火あり） |
| PATCH | `/api/comments/:commentId` | 🔒 ログイン（著者/権限） | コメントを編集 |
| DELETE | `/api/comments/:commentId` | 🔒 ログイン（著者/権限） | コメントを削除 |

## エンゲージメント（リアクション / ブックマーク）

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/articles/:id/engagement` | 🔒 ログイン | 記事のリアクション集計と自分の状態 |
| POST | `/api/articles/:id/reactions` | 🔒 ログイン | 絵文字リアクションを追加 |
| DELETE | `/api/articles/:id/reactions/:emoji` | 🔒 ログイン | 絵文字リアクションを削除 |
| POST | `/api/articles/:id/bookmark` | 🔒 ログイン | 記事をブックマーク |
| DELETE | `/api/articles/:id/bookmark` | 🔒 ログイン | ブックマークを解除 |
| GET | `/api/me/bookmarks` | 🔒 ログイン | 自分のブックマーク記事一覧 |

## 通知 `/api/notifications`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/notifications` | 🔒 ログイン | 通知一覧（カーソルページング） |
| GET | `/api/notifications/unread-count` | 🔒 ログイン | 未読通知の件数 |
| POST | `/api/notifications/read-all` | 🔒 ログイン | すべて既読にする |
| POST | `/api/notifications/:notificationId/read` | 🔒 ログイン | 指定通知を既読にする |

## アップロード `/api/uploads`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| POST | `/api/uploads` | 🔒 ログイン | 画像をアップロード（ストレージへ保存） |
| GET | `/api/uploads/:id` | 🔒 ログイン | アップロード済みファイルを取得・配信 |

## 検索 `/api/search`

| メソッド | パス | 認可 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/search` | 🔒 ログイン | 記事の全文検索（クエリ `q` ほか） |
