export type NotificationItem = {
  id: string;
  type: 'comment' | 'reply' | 'reaction' | 'mention';
  actorId: string;
  actorName: string;
  articleId: string;
  articleTitle: string;
  commentId: string | null;
  readAt: string | null;
  createdAt: string;
};

export function notificationMessage(n: Pick<NotificationItem, 'type' | 'actorName' | 'articleTitle'>): string {
  switch (n.type) {
    case 'comment':
      return `${n.actorName}さんが「${n.articleTitle}」にコメントしました`;
    case 'reply':
      return `${n.actorName}さんがあなたのコメントに返信しました（${n.articleTitle}）`;
    case 'reaction':
      return `${n.actorName}さんが「${n.articleTitle}」にリアクションしました`;
    case 'mention':
      return `${n.actorName}さんが「${n.articleTitle}」であなたをメンションしました`;
  }
}
