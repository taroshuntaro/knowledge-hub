// メンション記法: [@表示名](/users/<uuid>)（2026-07-07 決定）。
// UUID を DB 照合するのは notification-service 側。ここは構文抽出のみ。
const MENTION_RE =
  /\[@[^\]]*\]\(\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export function extractMentionedUserIds(bodyMd: string): string[] {
  // コードブロック・インラインコード内の記法は本文と見なさない（buildSearchText と同じ方針）
  const withoutCode = bodyMd.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const ids = new Set<string>();
  for (const m of withoutCode.matchAll(MENTION_RE)) ids.add(m[1].toLowerCase());
  return [...ids];
}
