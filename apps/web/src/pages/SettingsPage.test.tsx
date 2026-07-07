import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMeMock = vi.fn();
const patchMock = vi.fn();
const uploadImageMock = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      auth: {
        me: { $get: (...a: unknown[]) => getMeMock(...a) },
      },
      users: {
        me: {
          $patch: (...a: unknown[]) => patchMock(...a),
          password: { $post: vi.fn() },
        },
      },
    },
  },
}));

vi.mock('@/lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upload')>();
  return { ...actual, uploadImage: (...a: unknown[]) => uploadImageMock(...a) };
});

import { SettingsPage } from './SettingsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe('SettingsPage アバターアップロード', () => {
  beforeEach(() => {
    getMeMock.mockReset();
    patchMock.mockReset();
    uploadImageMock.mockReset();
    getMeMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'u1',
        email: 'user@example.com',
        displayName: '太郎',
        role: 'member',
        avatarUrl: null,
        bio: '',
      }),
    });
  });

  it('ファイル選択でアップロードし、保存クリックで PATCH ボディに avatarUrl が含まれる', async () => {
    uploadImageMock.mockResolvedValue({ url: '/api/uploads/11111111-1111-1111-1111-111111111111' });
    patchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderPage();

    await screen.findByLabelText('表示名');
    // useMe が非同期解決のため初期表示名 state は空。required 検証で送信がブロックされないよう入力する。
    await userEvent.type(screen.getByLabelText('表示名'), '太郎');

    const file = new File(['(binary)'], 'avatar.png', { type: 'image/png' });
    const input = document.querySelector('#settings-avatar') as HTMLInputElement;
    await userEvent.upload(input, file);

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(document.querySelector('img')).toHaveAttribute(
        'src',
        '/api/uploads/11111111-1111-1111-1111-111111111111',
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith({
        json: expect.objectContaining({ avatarUrl: '/api/uploads/11111111-1111-1111-1111-111111111111' }),
      }),
    );
  });

  it('既存アバターがある状態で無関係な保存をしても avatarUrl が失われない', async () => {
    const existingAvatarUrl = '/api/uploads/22222222-2222-2222-2222-222222222222';
    getMeMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'u1',
        email: 'user@example.com',
        displayName: '太郎',
        role: 'member',
        avatarUrl: existingAvatarUrl,
        bio: '',
      }),
    });
    patchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderPage();

    // me の非同期解決後に avatarUrl state が同期され、img が表示されることを確認する
    await waitFor(() => expect(document.querySelector('img')).toHaveAttribute('src', existingAvatarUrl));

    // displayName state は useMe 解決後も再同期されない既知の挙動のため、required 検証で送信がブロックされないよう入力する
    await userEvent.type(screen.getByLabelText('表示名'), '太郎');
    await userEvent.type(screen.getByLabelText('自己紹介'), '更新した自己紹介');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith({
        json: expect.objectContaining({ avatarUrl: existingAvatarUrl }),
      }),
    );
  });

  it('プレビュー選択後に me が同じ avatarUrl で再フェッチされてもプレビューは失われない', async () => {
    const originalAvatarUrl = '/api/uploads/33333333-3333-3333-3333-333333333333';
    getMeMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'u1',
        email: 'user@example.com',
        displayName: '太郎',
        role: 'member',
        avatarUrl: originalAvatarUrl,
        bio: '',
      }),
    });
    uploadImageMock.mockResolvedValue({ url: '/api/uploads/44444444-4444-4444-4444-444444444444' });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SettingsPage />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(document.querySelector('img')).toHaveAttribute('src', originalAvatarUrl));

    const file = new File(['(binary)'], 'avatar.png', { type: 'image/png' });
    const input = document.querySelector('#settings-avatar') as HTMLInputElement;
    await userEvent.upload(input, file);

    await waitFor(() =>
      expect(document.querySelector('img')).toHaveAttribute(
        'src',
        '/api/uploads/44444444-4444-4444-4444-444444444444',
      ),
    );

    // バックグラウンドで me が再フェッチされる（同じ avatarUrl だが新しいオブジェクト参照）
    getMeMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'u1',
        email: 'user@example.com',
        displayName: '太郎',
        role: 'member',
        avatarUrl: originalAvatarUrl,
        bio: '',
      }),
    });
    await queryClient.refetchQueries({ queryKey: ['me'] });

    // 選択したプレビューが元の avatarUrl に巻き戻されていないこと
    await waitFor(() =>
      expect(document.querySelector('img')).toHaveAttribute(
        'src',
        '/api/uploads/44444444-4444-4444-4444-444444444444',
      ),
    );
  });

  it('アップロード失敗時は profileMsg にエラーメッセージを表示する', async () => {
    uploadImageMock.mockRejectedValue(new Error('画像のアップロードに失敗しました（テスト）'));
    renderPage();

    await screen.findByLabelText('表示名');

    const file = new File(['(binary)'], 'avatar.png', { type: 'image/png' });
    const input = document.querySelector('#settings-avatar') as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(await screen.findByRole('status')).toHaveTextContent('画像のアップロードに失敗しました（テスト）');
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('avatarUrl が未設定なら Avatar のイニシャル表示（img なし・表示名の頭文字）になる', async () => {
    renderPage();

    await screen.findByLabelText('表示名');
    expect(document.querySelector('img')).toBeNull();
    await waitFor(() =>
      expect(document.querySelector('#settings-avatar')?.parentElement).toHaveTextContent('太'),
    );
  });

  it('avatarUrl が設定済みなら Avatar が name を alt にした img を描画する', async () => {
    const existingAvatarUrl = '/api/uploads/55555555-5555-5555-5555-555555555555';
    getMeMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'u1',
        email: 'user@example.com',
        displayName: '太郎',
        role: 'member',
        avatarUrl: existingAvatarUrl,
        bio: '',
      }),
    });
    renderPage();

    await waitFor(() => expect(document.querySelector('img')).toHaveAttribute('src', existingAvatarUrl));
    expect(document.querySelector('img')).toHaveAttribute('alt', '太郎');
  });

  it('SettingsPage は oidc ユーザーにパスワード変更カードを出さない', async () => {
    getMeMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'u1',
        email: 'user@example.com',
        displayName: '太郎',
        role: 'member',
        avatarUrl: null,
        bio: '',
        authProvider: 'oidc',
      }),
    });
    renderPage();

    await screen.findByLabelText('表示名');
    await waitFor(() => expect(getMeMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('パスワード変更')).toBeNull());
  });
});
