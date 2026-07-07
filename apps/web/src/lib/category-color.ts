// category.id を決定論的にカテゴリ色クラス（cat-dot-0〜5）へ写像する。
// 生色は index.css のクラス側に持ち、ここではクラス名だけを扱う。
const PALETTE_SIZE = 6;

export function categoryColorClass(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1_000_000_007;
  }
  return `cat-dot-${hash % PALETTE_SIZE}`;
}
