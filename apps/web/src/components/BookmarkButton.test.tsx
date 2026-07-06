import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEngagement = vi.fn();
const postBookmark = vi.fn();
const deleteBookmark = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      articles: {
        ':id': {
          engagement: { $get: (...args: unknown[]) => getEngagement(...args) },
          bookmark: {
            $post: (...args: unknown[]) => postBookmark(...args),
            $delete: (...args: unknown[]) => deleteBookmark(...args),
          },
        },
      },
    },
  },
}));

import { BookmarkButton } from './BookmarkButton';

function engagement(bookmarked: boolean) {
  return {
    reactions: {}, myReactions: [], bookmarked, commentCount: 0,
  };
}

function renderButton() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BookmarkButton articleId="a1" />
    </QueryClientProvider>,
  );
}

describe('BookmarkButton', () => {
  beforeEach(() => {
    getEngagement.mockReset();
    postBookmark.mockReset();
    deleteBookmark.mockReset();
  });

  it('未ブックマークでクリックすると POST が呼ばれ invalidate される', async () => {
    getEngagement
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => engagement(false) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => engagement(true) });
    postBookmark.mockResolvedValue({ ok: true, status: 204, json: async () => null });

    renderButton();

    const button = await screen.findByRole('button', { name: /ブックマーク/ });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);

    expect(postBookmark).toHaveBeenCalledWith(expect.objectContaining({ param: { id: 'a1' } }));
    expect(deleteBookmark).not.toHaveBeenCalled();
    await waitFor(() => expect(getEngagement).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
  });

  it('ブックマーク済みの状態が表示される', async () => {
    getEngagement.mockResolvedValue({ ok: true, status: 200, json: async () => engagement(true) });

    renderButton();

    const button = await screen.findByRole('button', { name: /ブックマーク/ });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('ブックマーク済み');
  });
});
