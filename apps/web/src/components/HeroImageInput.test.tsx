import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadImageWithIdMock = vi.fn();

vi.mock('@/lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upload')>();
  return { ...actual, uploadImageWithId: (...a: unknown[]) => uploadImageWithIdMock(...a) };
});

import { HeroImageInput } from './HeroImageInput';

describe('HeroImageInput', () => {
  beforeEach(() => {
    uploadImageWithIdMock.mockReset();
  });

  it('画像未設定なら上部を占有しないコンパクトな追加トリガーを表示する', () => {
    render(<HeroImageInput value={null} onChange={() => {}} />);
    expect(screen.getByText('ヒーロー画像を追加（任意）')).toBeInTheDocument();
    // 旧仕様の大きな 16:9 プレビュー枠（設定済み img）は出さない
    expect(screen.queryByRole('img', { name: 'ヒーロー画像' })).not.toBeInTheDocument();
  });

  it('ファイル選択でアップロードし onChange に uploadId を渡す', async () => {
    uploadImageWithIdMock.mockResolvedValue({ id: 'up1', url: '/api/uploads/up1' });
    const onChange = vi.fn();
    render(<HeroImageInput value={null} onChange={onChange} />);
    const file = new File([new Uint8Array([1, 2, 3])], 'h.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('ヒーロー画像を選択'), file);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('up1'));
  });

  it('設定済みなら画像プレビューと「削除」を表示し、削除で onChange(null)', async () => {
    const onChange = vi.fn();
    render(<HeroImageInput value="up1" onChange={onChange} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/uploads/up1');
    await userEvent.click(screen.getByRole('button', { name: '画像を削除' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('アップロードに失敗したらエラーを表示する', async () => {
    uploadImageWithIdMock.mockRejectedValue(new Error('画像のアップロードに失敗しました（テスト）'));
    const onChange = vi.fn();
    render(<HeroImageInput value={null} onChange={onChange} />);
    const file = new File([new Uint8Array([1, 2, 3])], 'h.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('ヒーロー画像を選択'), file);
    expect(await screen.findByRole('alert')).toHaveTextContent('画像のアップロードに失敗しました（テスト）');
    expect(onChange).not.toHaveBeenCalled();
  });
});
