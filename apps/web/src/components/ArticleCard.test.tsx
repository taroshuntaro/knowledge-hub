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
          authorAvatarUrl: null, categoryId: null, categoryName: null, heroImage: null,
          tags: [], reactionCount: 0, commentCount: 0,
          pinnedAt: null, publishedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
        }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /記事タイトル/ })).toHaveAttribute('href', '/articles/a1');
    expect(screen.getByText('太郎')).toBeInTheDocument();
  });

  it('カテゴリチップ・タグ・反応/コメント数・著者を表示する', () => {
    render(
      <MemoryRouter>
        <ArticleCard item={{
          id: 'a1', title: 'タイトル', excerpt: '要約', authorId: 'u1', authorName: '佐藤',
          authorAvatarUrl: null, categoryId: 'c1', categoryName: 'デザイン', heroImage: null,
          tags: ['design', 'ui'], reactionCount: 3, commentCount: 2,
          pinnedAt: null, publishedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
        }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('デザイン')).toBeInTheDocument();
    expect(screen.getByText('design')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'タイトル' })).toHaveAttribute('href', '/articles/a1');
    expect(screen.getByText('佐藤')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('heroImage があればサムネ画像、無ければフォールバックタイル', () => {
    const base = {
      id: 'a1', title: 'タイトル', excerpt: '', authorId: 'u1', authorName: '佐藤',
      authorAvatarUrl: null, categoryId: 'c1', categoryName: 'デザイン',
      tags: [], reactionCount: 0, commentCount: 0,
      pinnedAt: null, publishedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
    };
    const { container, rerender } = render(
      <MemoryRouter>
        <ArticleCard item={{ ...base, heroImage: '/api/uploads/up1' }} />
      </MemoryRouter>,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/uploads/up1');

    rerender(
      <MemoryRouter>
        <ArticleCard item={{ ...base, heroImage: null }} />
      </MemoryRouter>,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('pickup variant では 📌 ラベルとアクセントボーダーを表示する', () => {
    render(
      <MemoryRouter>
        <ArticleCard
          variant="pickup"
          item={{
            id: 'a1', title: 'タイトル', excerpt: '', authorId: 'u1', authorName: '佐藤',
            authorAvatarUrl: null, categoryId: null, categoryName: null, heroImage: null,
            tags: [], reactionCount: 0, commentCount: 0,
            pinnedAt: null, publishedAt: '2026-07-05T00:00:00Z', updatedAt: '2026-07-05T00:00:00Z',
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('📌 ピックアップ')).toBeInTheDocument();
  });
});
