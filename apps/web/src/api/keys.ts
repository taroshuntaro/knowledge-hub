/**
 * TanStack Query の queryKey を一元管理するファクトリ。
 * クエリ側と invalidate 側でリテラルが乖離すると「無音でキャッシュが更新されない」
 * バグになるため、キーは必ずここを経由する。
 * 注意: 各エントリの配列実体は従来のリテラルと同一に保つこと（キャッシュ互換）。
 * `keys.notifications.all` は recent / unreadCount / list の prefix であり、
 * invalidateQueries に渡すと 3 つまとめて無効化される（従来挙動）。
 */
export const keys = {
  me: ['me'] as const,
  authMethods: ['auth-methods'] as const,
  feed: ['feed'] as const,
  pickup: ['pickup'] as const,
  mine: (tab: 'draft' | 'published' | 'trash') => ['mine', tab] as const,
  bookmarks: ['bookmarks'] as const,
  category: (id: string) => ['category', id] as const,
  tag: (name: string) => ['tag', name] as const,
  userArticles: (userId: string) => ['user-articles', userId] as const,
  article: (id: string) => ['article', id] as const,
  comments: (articleId: string) => ['comments', articleId] as const,
  engagement: (articleId: string) => ['engagement', articleId] as const,
  categories: ['categories'] as const,
  user: (id: string) => ['user', id] as const,
  adminUsers: ['admin-users'] as const,
  profiles: ['profiles'] as const,
  adminDepartments: ['admin-departments'] as const,
  adminPositions: ['admin-positions'] as const,
  mentionCandidates: ['mention-candidates'] as const,
  search: (q: string, categoryId: string | null, tagName: string, authorId: string | null) =>
    ['search', q, categoryId, tagName, authorId] as const,
  notifications: {
    all: ['notifications'] as const,
    recent: ['notifications', 'recent'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
    list: ['notifications', 'list'] as const,
  },
} as const;
