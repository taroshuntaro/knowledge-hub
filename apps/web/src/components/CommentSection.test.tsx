import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const me = {
  id: 'u1',
  email: 'me@example.com',
  displayName: '自分',
  role: 'member',
  avatarUrl: null,
  bio: '',
};

const getMe = vi.fn();
const getComments = vi.fn();
const postComment = vi.fn();
const patchComment = vi.fn();
const deleteComment = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      auth: { me: { $get: (...args: unknown[]) => getMe(...args) } },
      articles: {
        ':id': {
          comments: {
            $get: (...args: unknown[]) => getComments(...args),
            $post: (...args: unknown[]) => postComment(...args),
          },
        },
      },
      comments: {
        ':commentId': {
          $patch: (...args: unknown[]) => patchComment(...args),
          $delete: (...args: unknown[]) => deleteComment(...args),
        },
      },
    },
  },
}));

import { CommentSection } from './CommentSection';

function makeComment(overrides: Partial<{
  id: string;
  authorId: string;
  authorName: string;
  bodyMd: string | null;
  isDeleted: boolean;
  replies: unknown[];
}> = {}) {
  return {
    id: 'c1',
    articleId: 'a1',
    authorId: 'u2',
    authorName: '他人',
    parentId: null,
    bodyMd: '**本文**',
    isDeleted: false,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    replies: [],
    ...overrides,
  };
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CommentSection articleId="a1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CommentSection', () => {
  beforeEach(() => {
    getMe.mockReset();
    getComments.mockReset();
    postComment.mockReset();
    patchComment.mockReset();
    deleteComment.mockReset();
    getMe.mockResolvedValue({ ok: true, status: 200, json: async () => me });
  });

  it('コメント一覧が描画され、本文が Markdown 描画される', async () => {
    getComments.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [makeComment({ bodyMd: '**強調**' })], nextCursor: null }),
    });

    renderSection();

    const strong = await screen.findByText('強調');
    expect(strong.tagName).toBe('STRONG');
  });

  it('削除済みコメントは「削除されました」を表示し、本文は描画しない', async () => {
    getComments.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [makeComment({ bodyMd: null, isDeleted: true })],
        nextCursor: null,
      }),
    });

    renderSection();

    expect(await screen.findByText('削除されました')).toBeInTheDocument();
  });

  it('投稿フォーム送信で POST が呼ばれ、コメント一覧が invalidate される', async () => {
    getComments.mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [], nextCursor: null }) });
    postComment.mockResolvedValue({ ok: true, status: 200, json: async () => makeComment() });

    renderSection();

    await screen.findByText('まだコメントはありません');

    await userEvent.type(screen.getByLabelText('コメント'), '新しいコメント');
    await userEvent.click(screen.getByRole('button', { name: 'コメントする' }));

    expect(postComment).toHaveBeenCalledWith(
      expect.objectContaining({
        param: { id: 'a1' },
        json: expect.objectContaining({ bodyMd: '新しいコメント' }),
      }),
    );
    expect(getComments.mock.calls.length).toBeGreaterThan(1);
  });

  it('自分のコメントには編集/削除が出て、他人のコメントには出ない', async () => {
    getComments.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          makeComment({ id: 'own', authorId: 'u1', authorName: '自分' }),
          makeComment({ id: 'other', authorId: 'u2', authorName: '他人' }),
        ],
        nextCursor: null,
      }),
    });

    renderSection();

    await screen.findByText('他人');

    const editButtons = await screen.findAllByRole('button', { name: '編集' });
    const deleteButtons = await screen.findAllByRole('button', { name: '削除' });
    expect(editButtons).toHaveLength(1);
    expect(deleteButtons).toHaveLength(1);
  });
});
