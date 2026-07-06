import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEngagement = vi.fn();
const postReaction = vi.fn();
const deleteReaction = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      articles: {
        ':id': {
          engagement: { $get: (...args: unknown[]) => getEngagement(...args) },
          reactions: {
            $post: (...args: unknown[]) => postReaction(...args),
            ':emoji': {
              $delete: (...args: unknown[]) => deleteReaction(...args),
            },
          },
        },
      },
    },
  },
}));

import { ReactionBar } from './ReactionBar';

function baseEngagement(overrides: Partial<{
  reactions: Record<string, number>;
  myReactions: string[];
}> = {}) {
  return {
    reactions: { '👍': 2, '❤️': 0, '🎉': 0, '🙌': 0, '👀': 0 },
    myReactions: [],
    bookmarked: false,
    commentCount: 0,
    ...overrides,
  };
}

function renderBar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReactionBar articleId="a1" />
    </QueryClientProvider>,
  );
}

describe('ReactionBar', () => {
  beforeEach(() => {
    getEngagement.mockReset();
    postReaction.mockReset();
    deleteReaction.mockReset();
  });

  it('件数と自分の押下状態が描画される', async () => {
    getEngagement.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => baseEngagement({ myReactions: ['👍'] }),
    });

    renderBar();

    const likeButton = await screen.findByRole('button', { name: /👍/ });
    expect(likeButton).toHaveTextContent('2');
    expect(likeButton).toHaveAttribute('aria-pressed', 'true');

    const partyButton = screen.getByRole('button', { name: /🎉/ });
    expect(partyButton).toHaveTextContent('0');
    expect(partyButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('未押下の絵文字クリックで即座に +1 され POST が呼ばれる', async () => {
    getEngagement
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => baseEngagement() })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => baseEngagement({ reactions: { '👍': 3, '❤️': 0, '🎉': 0, '🙌': 0, '👀': 0 }, myReactions: ['👍'] }),
      });
    postReaction.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => baseEngagement({ reactions: { '👍': 3, '❤️': 0, '🎉': 0, '🙌': 0, '👀': 0 }, myReactions: ['👍'] }),
    });

    renderBar();

    const likeButton = await screen.findByRole('button', { name: /👍/ });
    expect(likeButton).toHaveTextContent('2');

    await userEvent.click(likeButton);

    await waitFor(() => expect(likeButton).toHaveTextContent('3'));
    expect(likeButton).toHaveAttribute('aria-pressed', 'true');
    expect(postReaction).toHaveBeenCalledWith(
      expect.objectContaining({ param: { id: 'a1' }, json: { emoji: '👍' } }),
    );
    expect(deleteReaction).not.toHaveBeenCalled();
  });

  it('押下済みをクリックで -1 され DELETE が呼ばれる', async () => {
    getEngagement
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => baseEngagement({ myReactions: ['👍'] }) })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => baseEngagement({ reactions: { '👍': 1, '❤️': 0, '🎉': 0, '🙌': 0, '👀': 0 }, myReactions: [] }),
      });
    deleteReaction.mockResolvedValue({ ok: true, status: 204, json: async () => null });

    renderBar();

    const likeButton = await screen.findByRole('button', { name: /👍/ });
    expect(likeButton).toHaveTextContent('2');

    await userEvent.click(likeButton);

    await waitFor(() => expect(likeButton).toHaveTextContent('1'));
    expect(likeButton).toHaveAttribute('aria-pressed', 'false');
    expect(deleteReaction).toHaveBeenCalledWith(
      expect.objectContaining({ param: { id: 'a1', emoji: '👍' } }),
    );
  });

  it('API 失敗時は件数が元に戻る（ロールバック）', async () => {
    getEngagement.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => baseEngagement(),
    });
    let rejectPost!: (res: unknown) => void;
    postReaction.mockImplementation(
      () => new Promise((resolve) => { rejectPost = resolve; }),
    );

    renderBar();

    const likeButton = await screen.findByRole('button', { name: /👍/ });
    expect(likeButton).toHaveTextContent('2');

    await userEvent.click(likeButton);

    // optimistic update applies immediately, before the (still-pending) API call resolves
    await waitFor(() => expect(likeButton).toHaveTextContent('3'));
    expect(likeButton).toHaveAttribute('aria-pressed', 'true');

    // API resolves with a failure response -> rollback restores the original state
    rejectPost({ ok: false, status: 500, json: async () => ({ message: 'error' }) });

    await waitFor(() => expect(likeButton).toHaveTextContent('2'));
    expect(likeButton).toHaveAttribute('aria-pressed', 'false');
    expect(postReaction).toHaveBeenCalled();
  });
});
