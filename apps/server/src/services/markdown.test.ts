import { describe, expect, it } from 'vitest';
import { buildSearchText } from './markdown';

describe('buildSearchText', () => {
  it('タイトル・本文平文・タグを連結する', () => {
    const s = buildSearchText({
      title: '入門ガイド',
      bodyMd: '# 見出し\n\n**太字** と [リンク](https://ex.com) と `code`。',
      tags: ['AWS', '新人向け'],
    });
    expect(s).toContain('入門ガイド');
    expect(s).toContain('見出し');
    expect(s).toContain('太字');
    expect(s).toContain('リンク');
    expect(s).toContain('AWS');
    expect(s).toContain('新人向け');
  });

  it('Markdown 記号（#, *, [], 記法）を落とす', () => {
    const s = buildSearchText({ title: 't', bodyMd: '## H\n- item\n> quote', tags: [] });
    expect(s).not.toContain('##');
    expect(s).not.toContain('- item'.slice(0, 2)); // 行頭のリストマーカー '- ' を除去
    expect(s).toContain('item');
    expect(s).toContain('quote');
  });

  it('識別子内のアンダースコアは保持する（検索語を壊さない）', () => {
    const s = buildSearchText({ title: 't', bodyMd: 'set API_KEY and my_var_name', tags: [] });
    expect(s).toContain('API_KEY');
    expect(s).toContain('my_var_name');
  });

  it('_強調_ のアンダースコアは除去する', () => {
    const s = buildSearchText({ title: 't', bodyMd: 'これは _強調_ です', tags: [] });
    expect(s).toContain('強調');
    expect(s).not.toContain('_強調_');
  });
});
