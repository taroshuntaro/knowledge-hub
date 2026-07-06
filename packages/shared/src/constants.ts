/** リアクションで使える絵文字プリセット（この順で UI に表示）。サーバー検証の唯一の真実 */
export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '🙌', '👀'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
