# 保留バックログ一掃（リファクタ + Minor 修正）設計

日付: 2026-07-11 / ステータス: 承認済み

## 目的

ロードマップ完走後に台帳・レビューで「保留」とした項目のうち、対応価値のあるものを一括で解消する。機能追加はなし。API 契約の変更は comment mutation レスポンスの形状統一のみ。

## スコープ外（理由付き・再開しない）

- keyset カーソル述語の共通 helper 化 — 4 コピーは date_trunc 有無/方向/タイブレーク列が異なり、統合の抽象化ミスは過去 2 回踏んだ「同一 ms タイで行が恒久スキップ」バグを再導入しうる。テスト済みの現状 > 将来ドリフト。
- ヘッダ検索ボックスの URL 同期 — S1 でヘッダ検索自体を廃止済み（陳腐化）。
- SettingsPage 派生 state 再同期 / EditorPage の useArticle 化 — 自動保存が絡む挙動変更でリスク > 益。
- 4c-2 で理由付きクローズした C 群（M-2/M-8/M-9/M-11 等）、4b 残り（リプレイテスト・settings フラッシュ・config スタイル）— 費用対効果低。

## 作業構成

3 ブランチに分割し、各 `--no-ff` で main へマージ。純粋リファクタと契約変更/挙動修正を混ぜない。

### ブランチ 1: `refactor/server-consolidation`（挙動不変）

1. **記事カード列 + metadata 付与の統合**: article-service に基底定数 `ARTICLE_CARD_COLUMNS`（現 `LIST_COLUMNS` を改名・export）を置き、engagement の `BOOKMARK_COLUMNS` は `{...ARTICLE_CARD_COLUMNS, bookmarkedAt, bookmarkId}`、search は `{...ARTICLE_CARD_COLUMNS 相当, snippet}` の spread + 差分宣言に置換。search は select を spread + `snippet` 追加とし、レスポンス mapping で excerpt/pinnedAt を含めない（現行 API 形状を維持）。「取得→`fetchListMetadata`→map で合成」の呼び出し定型も `enrichListItems` 系ヘルパーに寄せられる範囲で寄せる。**全 API レスポンス形状は不変・既存テスト無修正 green が合格条件。**
2. **mention 通知 2 関数の統合**: `notifyCommentMentionsOnEdit` / `notifyArticleMentions` の共通部（メンション抽出→受信者解決→dedupe→insert）を private ヘルパーに抽出。通知の発生条件・優先度は不変。
3. **articles routes の `:id` 検証ミドルウェア化**: ルートごとの `requireUuidParam` 呼び出しをルータレベルのミドルウェアに集約（routes/articles.ts 内、guards.ts のヘルパーは維持）。
4. **`@types/nodemailer` 要否確認**: nodemailer 9 が型を同梱していれば devDependency から削除。typecheck green で判定。

### ブランチ 2: `fix/server-minors`（挙動修正・契約変更）

1. **リビジョン一覧のタイブレーク**: `orderBy(desc(savedAt))` に `desc(id)` を追加（article-service の 2 箇所）。同一タイムスタンプ保存時の順序を決定的に。
2. **assertCategoryExists の TOCTOU**: 記事更新 tx の外で行っているカテゴリ存在チェックを tx 内（FOR UPDATE 済み read と同じトランザクション）へ移動。
3. **replies の防御上限**: listComments の返信取得（既に 1 クエリ）に `row_number() OVER (PARTITION BY parent_id ORDER BY created_at, id)` で**親あたり 100 件**の上限。超過分は切り捨て（1 階層制限下で現実に到達しない防御値）。
4. **comment mutation レスポンスの形状統一**: shared に `CommentItem`（list の node から `replies` を除いた形）を定義し、`CommentNode = CommentItem + replies` に再構成。createComment/updateComment は insert/update 後に author JOIN 付きで再 SELECT して `CommentItem` を返す。Web 側は hc 推論で追従（authorName 等が使えるようになる）。**削除済みコメントの bodyMd 非返却などの既存の可視性規則は list と同一に揃える。**
5. **avatarUrl の所有チェック**: updateProfile で avatarUrl 指定時、`uploads.id` の存在 + `uploaderId === 本人` を検証。違反は 400（AppError）。既存の「/api/uploads/<uuid> 形式のみ許可」チェックは維持。
6. **request-id レスポンスヘッダ**: request-logger が生成する UUID を `X-Request-Id` レスポンスヘッダに付与。

### ブランチ 3: `refactor/web-cleanup`

1. **query-key ファクトリ**: `apps/web/src/api/keys.ts` に全キーを関数/定数で定義（`keys.me`, `keys.comments(articleId)`, `keys.engagement(articleId)`, `keys.notifications.unreadCount`, `keys.categories`, `keys.article(id)` 等）。クエリ側・invalidate 側の全リテラル（~35 箇所）を移行。**キーの実体配列は現状と同一**（キャッシュ互換の純置換）。
2. **admin-or-owner hook**: `auth/useCanManage.ts` に `useCanManage(authorId?: string): boolean` を新設（`me.role === 'admin' || me.id === authorId`、me 未解決は false）。CommentSection・ArticleDetailPage の 2 箇所を置換。
3. **公開パネルの閉じ順**: EditorPage の公開ボタンを `await publish()` 成功後に `setPublishOpen(false)` へ。失敗時はパネルを開いたまま既存のエラー表示。
4. **HomePage の `as ArticleItem[]` キャスト除去**（最後の残存 cast）。
5. **MentionTextarea の候補リスト a11y**: listbox 内の装飾 button の役割整理（option 役割と操作の整合）。
6. **記事詳細テストに href 検証追加**（著者リンク等、既存テストの assert 強化）。

## テスト方針

- ブランチ 1 は既存テスト無修正 green（リファクタの合格条件）。
- ブランチ 2 は各修正に server 統合テストを追加: タイブレーク（同一 savedAt 2 行）／replies 上限（101 件で 100 打ち切り）／comment mutation 形状（authorName 含む・shared スキーマ parse 通過）／avatarUrl 他人 UUID → 400／`X-Request-Id` ヘッダ存在。
- ブランチ 3 は useCanManage 単体・公開パネル失敗時に開いたまま、の web テスト追加。query-key 移行はキー配列の同一性を型 or テストで担保しつつ既存テスト green。
- 最終ゲート: `pnpm run verify` exit 0 + E2E フル 10/10（クリーン state）。

## リスクと緩和

- **comment 形状変更**: クライアントは同一リポジトリのみ。shared Zod を先に変え、typecheck で全消費箇所を洗い出す。
- **query-key 移行**: キー配列を変えると invalidate が無音で効かなくなる。ファクトリは既存リテラルの写しであることを 1 箇所ずつ突き合わせ、レビューで確認。
- **カード列統合**: search/bookmarks の API 形状差分を spread の差分宣言として明示し、レスポンス snapshot 的な既存テストの無修正 green で担保。
