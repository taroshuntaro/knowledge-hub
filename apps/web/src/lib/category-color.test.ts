import { describe, expect, it } from 'vitest';
import { categoryColorClass } from './category-color';

describe('categoryColorClass', () => {
  it('cat-dot-0〜5 のいずれかを返す', () => {
    expect(categoryColorClass('any-id')).toMatch(/^cat-dot-[0-5]$/);
  });
  it('同じ id では常に同じクラス（決定論的）', () => {
    expect(categoryColorClass('abc')).toBe(categoryColorClass('abc'));
  });
  it('異なる id で分散する（少なくとも 2 種類に割れる）', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const set = new Set(ids.map(categoryColorClass));
    expect(set.size).toBeGreaterThan(1);
  });
});
