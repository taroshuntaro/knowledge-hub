export type Role = 'member' | 'admin';
export type ArticleStatus = 'draft' | 'published';
export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  avatarUrl: string | null;
  bio: string;
  authProvider: 'oidc' | 'password';
};

export type ArticleEngagement = {
  reactions: Record<string, number>;
  myReactions: string[];
  bookmarked: boolean;
  commentCount: number;
};

/**
 * 一覧カード（ArticleCard）が表示する記事のワイヤー形状。
 * サーバー内部の一覧型（ArticleListItem 等）は Date を持つが、JSON 経由で
 * web が受け取る形はこの string 日付版。web の一覧・カードはこの型を単一の
 * 情報源として消費する（フィード / カテゴリ / タグ / 著者 / マイ記事 /
 * ピックアップ / ブックマーク / 検索が同一カードを共有する）。
 */
export type ArticleCardData = {
  id: string;
  title: string;
  excerpt: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  heroImage: string | null;
  tags: string[];
  reactionCount: number;
  commentCount: number;
  pinnedAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
};

/** コメント 1 件の wire 形状（日付は ISO 文字列）。list のツリーは CommentNodeData。 */
export type CommentItemData = {
  id: string;
  articleId: string;
  authorId: string;
  authorName: string;
  parentId: string | null;
  bodyMd: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};
export type CommentNodeData = CommentItemData & { replies: CommentItemData[] };
