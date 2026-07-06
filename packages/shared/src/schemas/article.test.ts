import { describe, expect, it } from 'vitest';
import {
  createArticleSchema,
  updateArticleSchema,
  listQuerySchema,
  categoryCreateSchema,
  searchQuerySchema,
} from './article';

describe('article schemas', () => {
  it('createArticleSchema: 最小の下書き入力を通す（categoryId 省略可）', () => {
    const r = createArticleSchema.safeParse({ title: 'メモ', bodyMd: '', tags: [] });
    expect(r.success).toBe(true);
  });

  it('createArticleSchema: title 空は不可', () => {
    const r = createArticleSchema.safeParse({ title: '', bodyMd: 'x', tags: [] });
    expect(r.success).toBe(false);
  });

  it('createArticleSchema: tags は最大 10 個・各 30 文字', () => {
    const r = createArticleSchema.safeParse({
      title: 't',
      bodyMd: '',
      tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
    });
    expect(r.success).toBe(false);
  });

  it('updateArticleSchema: expectedUpdatedAt が必須', () => {
    const r = updateArticleSchema.safeParse({ title: 't', bodyMd: '', tags: [] });
    expect(r.success).toBe(false);
  });

  it('listQuerySchema: limit を coerce しデフォルト 20', () => {
    const r = listQuerySchema.parse({});
    expect(r.limit).toBe(20);
  });

  it('categoryCreateSchema: name 必須', () => {
    expect(categoryCreateSchema.safeParse({ name: '' }).success).toBe(false);
    expect(categoryCreateSchema.safeParse({ name: 'テック' }).success).toBe(true);
  });

  it('searchQuerySchema: q 空文字は不可', () => {
    const r = searchQuerySchema.safeParse({ q: '' });
    expect(r.success).toBe(false);
  });

  it('searchQuerySchema: q 101 文字は不可', () => {
    const r = searchQuerySchema.safeParse({ q: 'a'.repeat(101) });
    expect(r.success).toBe(false);
  });

  it('searchQuerySchema: 最小入力を通し limit=20 が既定になる', () => {
    const r = searchQuerySchema.parse({ q: '検索' });
    expect(r.limit).toBe(20);
  });
});
