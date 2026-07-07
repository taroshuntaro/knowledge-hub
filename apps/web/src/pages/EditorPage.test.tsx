import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.fn();
const getMock = vi.fn();
const patchMock = vi.fn();
const publishMock = vi.fn();
const navigateMock = vi.fn();
const uploadImageMock = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    api: {
      articles: {
        $post: (...a: unknown[]) => postMock(...a),
        ':id': {
          $get: (...a: unknown[]) => getMock(...a),
          $patch: (...a: unknown[]) => patchMock(...a),
          publish: { $post: (...a: unknown[]) => publishMock(...a) },
        },
      },
      categories: { $get: vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) },
    },
  },
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigateMock };
});

// 画像 D&D / ペーストのテスト用に uploadImage だけ差し替える。firstImageFile は
// 純関数のまま実体を使う（他所で単体テスト済みのためロジックの重複は避ける）。
vi.mock('@/lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upload')>();
  return { ...actual, uploadImage: (...a: unknown[]) => uploadImageMock(...a) };
});

import { canEnterRich, EditorPage } from './EditorPage';

function renderNew() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/articles/new']}>
        <Routes>
          <Route path="/articles/new" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderEdit(id: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/articles/${id}/edit`]}>
        <Routes>
          <Route path="/articles/:id/edit" element={<EditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EditorPage', () => {
  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    patchMock.mockReset();
    publishMock.mockReset();
    navigateMock.mockReset();
    uploadImageMock.mockReset();
  });

  it('タイトル入力で下書きを作成する（POST 呼び出し）', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-05T00:00:00Z' }) });
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }));
    expect(postMock).toHaveBeenCalled();
  });

  it('新規作成の保存ペイロードに heroImageUploadId（未設定時は null）を含める', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-05T00:00:00Z' }) });
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }));
    expect(postMock).toHaveBeenCalledWith({
      json: expect.objectContaining({ heroImageUploadId: null }),
    });
  });

  it('既存記事のロードで heroImageUploadId が反映され、更新ペイロードに含まれる', async () => {
    getMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'a1', title: '既存記事', bodyMd: '本文', categoryId: null, tags: [],
        updatedAt: '2026-07-05T00:00:00Z', heroImageUploadId: 'up1',
      }),
    });
    patchMock.mockResolvedValue({ ok: true, json: async () => ({ updatedAt: '2026-07-06T00:00:00Z' }) });
    renderEdit('a1');
    await screen.findByDisplayValue('既存記事');
    expect(screen.getByRole('img', { name: 'ヒーロー画像' })).toHaveAttribute('src', '/api/uploads/up1');
    await userEvent.type(screen.getByLabelText('タイトル'), '追記');
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }));
    expect(patchMock).toHaveBeenCalledWith({
      param: { id: 'a1' },
      json: expect.objectContaining({ heroImageUploadId: 'up1' }),
    });
  });

  it('保存が in-flight の間に再度保存しても記事は 1 つしか作られない', async () => {
    let resolveFirst!: (v: unknown) => void;
    patchMock.mockResolvedValue({ ok: true, json: async () => ({ updatedAt: 'x' }) });
    postMock
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValue({ ok: true, json: async () => ({ id: 'a2', updatedAt: 'x' }) });
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'race');
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' }));
    await userEvent.click(screen.getByRole('button', { name: '下書き保存' })); // 1 発目が未解決のまま
    resolveFirst({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-06T00:00:00Z' }) });
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument());
    expect(postMock).toHaveBeenCalledTimes(1); // 2 回目は id 確定後なので PATCH になる（POST は 1 回）
  });

  it('新規記事を公開すると、保存で得た id で公開 API を呼ぶ（自動保存を待たずに）', async () => {
    postMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'a1', updatedAt: '2026-07-05T00:00:00Z' }) });
    publishMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderNew();
    await userEvent.type(screen.getByLabelText('タイトル'), 'あたらしい記事');
    await userEvent.click(screen.getByRole('button', { name: '公開する' }));
    expect(publishMock).toHaveBeenCalledWith({ param: { id: 'a1' } });
    expect(navigateMock).toHaveBeenCalledWith('/articles/a1');
  });

  it('既存記事を公開すると、id があっても直近の編集を保存（PATCH）してから公開する', async () => {
    getMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'a1', title: '既存記事', bodyMd: '本文', categoryId: null, tags: [], updatedAt: '2026-07-05T00:00:00Z' }),
    });
    patchMock.mockResolvedValue({ ok: true, json: async () => ({ updatedAt: '2026-07-06T00:00:00Z' }) });
    publishMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderEdit('a1');
    await screen.findByDisplayValue('既存記事');
    await userEvent.type(screen.getByLabelText('タイトル'), '追記'); // デバウンス（2秒）が発火する前に公開する
    await userEvent.click(screen.getByRole('button', { name: '公開する' }));
    expect(patchMock).toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledWith({ param: { id: 'a1' } });
    expect(patchMock.mock.invocationCallOrder[0]).toBeLessThan(publishMock.mock.invocationCallOrder[0]);
  });

  it('既存記事の読み込みに失敗したらエラー表示し、エディタフォームは出さない', async () => {
    getMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    renderEdit('a1');
    expect(await screen.findByRole('alert')).toHaveTextContent('記事の読み込みに失敗しました');
    expect(screen.queryByLabelText('タイトル')).not.toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('新規記事はリッチモードで開き、Markdown タブでソースに切り替わる', async () => {
    renderNew();
    expect(screen.getByRole('button', { name: 'リッチ' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    expect(screen.getByRole('button', { name: 'Markdown' })).toHaveAttribute('aria-pressed', 'true');
  });

  // 以下は Task 5 (c2c34cf) で追加された、ソースモード（CodeMirror）側の画像
  // D&D / ペースト配線の結合テスト。ラッパー <div> の onDrop/onPaste は React の
  // 合成イベントとして直接その要素に登録されているため、fireEvent.drop/paste を
  // ラッパー自身に投げれば ProseMirror のような座標解決なしにハンドラへ届く。
  // ラッパーには専用の data-testid 等が無いため、EditorPage.tsx 側の
  // `className="overflow-hidden rounded-lg border"`（ソースモード時のみ描画され、
  // リッチモードの RichEditor ラッパーとは同時に存在しない）で特定する。

  it('ソースモードで画像をドロップすると本文末尾に ![](url) が追記され、プレビューに反映される', async () => {
    uploadImageMock.mockResolvedValue({ url: 'https://example.com/photo.png' });
    renderNew();
    await userEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    const wrapper = document.querySelector('.overflow-hidden.rounded-lg.border');
    expect(wrapper).not.toBeNull();
    const file = new File(['(binary)'], 'photo.png', { type: 'image/png' });

    fireEvent.drop(wrapper!, { dataTransfer: { files: [file], getData: () => '' } });

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledWith(file));
    const preview = screen.getByLabelText('プレビュー');
    await waitFor(() => expect(preview.querySelector('img')).not.toBeNull());
    expect(preview.querySelector('img')).toHaveAttribute('src', 'https://example.com/photo.png');
  });

  it('ソースモードでの画像ドロップが失敗すると alert でエラーメッセージを表示する', async () => {
    uploadImageMock.mockRejectedValue(new Error('画像のアップロードに失敗しました（テスト）'));
    renderNew();
    await userEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    const wrapper = document.querySelector('.overflow-hidden.rounded-lg.border');
    expect(wrapper).not.toBeNull();
    const file = new File(['(binary)'], 'photo.png', { type: 'image/png' });

    fireEvent.drop(wrapper!, { dataTransfer: { files: [file], getData: () => '' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('画像のアップロードに失敗しました（テスト）');
  });

  it('ソースモードで画像以外をドロップしても uploadImage は呼ばれない', async () => {
    renderNew();
    await userEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    const wrapper = document.querySelector('.overflow-hidden.rounded-lg.border');
    expect(wrapper).not.toBeNull();
    const textFile = new File(['plain text'], 'note.txt', { type: 'text/plain' });

    fireEvent.drop(wrapper!, { dataTransfer: { files: [textFile], getData: () => '' } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(uploadImageMock).not.toHaveBeenCalled();
  });
});

describe('canEnterRich（ソース→リッチ切替ガードの純関数）', () => {
  it('無損失な Markdown はそのままリッチに入れる', () => {
    expect(canEnterRich('# 見出し1\n\n## 見出し2')).toEqual({ ok: true });
  });

  it('無損失でない Markdown（生 HTML 混在）は変換後の Markdown を添えて拒否する', () => {
    const guard = canEnterRich('<div class="x">raw html</div>');
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.converted).not.toContain('<div');
    }
  });
});
