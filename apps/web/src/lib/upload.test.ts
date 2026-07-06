import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstImageFile, uploadImage } from './upload';

describe('uploadImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('成功時は { url } を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: '/uploads/abc.png' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['dummy'], 'abc.png', { type: 'image/png' });
    await expect(uploadImage(file)).resolves.toEqual({ url: '/uploads/abc.png' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/uploads',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
  });

  it('失敗時はサーバーの message を持つ Error を投げる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'ファイルが大きすぎます' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['dummy'], 'abc.png', { type: 'image/png' });
    await expect(uploadImage(file)).rejects.toThrow('ファイルが大きすぎます');
  });
});

describe('firstImageFile', () => {
  it('画像ファイルがあれば最初の 1 件を返す', () => {
    const text = new File(['x'], 'a.txt', { type: 'text/plain' });
    const image = new File(['x'], 'a.png', { type: 'image/png' });
    const list = [text, image] as unknown as FileList;
    expect(firstImageFile(list)).toBe(image);
  });

  it('画像ファイルが無ければ null を返す', () => {
    const text = new File(['x'], 'a.txt', { type: 'text/plain' });
    const list = [text] as unknown as FileList;
    expect(firstImageFile(list)).toBeNull();
    expect(firstImageFile(null)).toBeNull();
    expect(firstImageFile(undefined)).toBeNull();
  });
});
