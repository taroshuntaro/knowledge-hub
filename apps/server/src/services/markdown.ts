export function buildSearchText(input: {
  title: string;
  bodyMd: string;
  tags: string[];
}): string {
  const plain = input.bodyMd
    .replace(/```[\s\S]*?```/g, ' ') // コードブロック
    .replace(/`([^`]*)`/g, '$1') // インラインコード
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // 画像/リンク → テキストのみ
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 見出しマーカー
    .replace(/^\s{0,3}>\s?/gm, '') // 引用マーカー
    .replace(/^\s*[-*+]\s+/gm, '') // 箇条書きマーカー
    .replace(/^\s*\d+\.\s+/gm, '') // 番号付きマーカー
    .replace(/[*~]{1,3}([^*~]+)[*~]{1,3}/g, '$1') // *太字* ~打消し~
    .replace(/(?<![\w])_{1,3}([^_]+)_{1,3}(?!\w)/g, '$1') // _強調_（識別子内 _ は保持）
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ') // 水平線
    .replace(/\|/g, ' ') // テーブル区切り
    .replace(/\s+/g, ' ')
    .trim();
  return [input.title, plain, ...input.tags].join(' ').trim();
}
