import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ArticleCard } from './ArticleCard';

describe('ArticleCard', () => {
  it('タイトルと著者を表示しリンクする', () => {
    render(
      <MemoryRouter>
        <ArticleCard item={{
          id: 'a1', title: '記事タイトル', excerpt: '要約', authorId: 'u1', authorName: '太郎',
          categoryId: null, pinnedAt: null, publishedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
        }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /記事タイトル/ })).toHaveAttribute('href', '/articles/a1');
    expect(screen.getByText('太郎')).toBeInTheDocument();
  });
});
