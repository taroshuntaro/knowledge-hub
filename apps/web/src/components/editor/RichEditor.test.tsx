import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RichEditor } from './RichEditor';

// jsdom の欠損 API スタブ（Range.getClientRects 等）は複数テストファイルで
// 必要なため src/test/setup.ts に集約済み。

/**
 * fireEvent.drop/paste に渡す DataTransfer/ClipboardData の簡易スタブ。
 * tiptap の PasteRule プラグインが handlePaste 判定より先に
 * event.clipboardData.getData(...) を呼ぶため、files だけでなく
 * getData も生やしておかないと（本テストの対象外である）別プラグインで
 * 例外になる。
 */
function makeDataTransfer(files: File[]) {
  return { files, getData: () => '', types: [] as string[] };
}

/**
 * ProseMirror の handleDrop/handlePaste は独自ハンドラを呼ぶ前に
 * view.posAtCoords(eventCoords(event)) でドロップ位置を解決しようとする
 * （解決できないと editorProps.handleDrop 自体が呼ばれず早期 return する）。
 * posAtCoords はまず document.elementFromPoint に依拠するが、
 * src/test/setup.ts はレイアウトを持たない jsdom 向けに
 * `document.elementFromPoint = () => null` を全テスト共通で当てている。
 * ここでは対象のコンテンツ要素自身を返すよう一時的に差し替え、位置解決を
 * 成功させる（テスト終了時に必ず元に戻す）。
 */
const dropCoords = { clientX: 0, clientY: 0 };

function withElementFromPoint<T>(el: Element, fn: () => T): T {
  const original = document.elementFromPoint;
  document.elementFromPoint = () => el;
  try {
    return fn();
  } finally {
    document.elementFromPoint = original;
  }
}

describe('RichEditor', () => {
  it('初期 Markdown をリッチ表示し、太字トグルで onChangeMarkdown に ** が流れる', async () => {
    const onChange = vi.fn();
    render(<RichEditor initialMarkdown="# 見出し\n\n本文" onChangeMarkdown={onChange} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('見出し');
    // 全選択 → 太字
    // jsdom の navigator.platform は空文字で mac 判定が false になるため、
    // prosemirror-keymap の "Mod-a"（selectAll）は Control として登録される。
    // 実ブラウザでは Meta/Ctrl どちらでも Mod に解決されるが、この環境差は
    // テスト都合でありプロダクトコードの挙動には影響しない。
    const content = screen.getByLabelText('本文（リッチエディタ）');
    await userEvent.click(content);
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.click(screen.getByRole('button', { name: '太字' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 2000 });
    expect(onChange.mock.calls.at(-1)![0]).toContain('**');
  });

  // 以下は Task 5 (c2c34cf) で追加された画像 D&D / ペースト配線の結合テスト。
  // ProseMirror の handleDrop/handlePaste は editor.view.dom への実 DOM リスナー
  // として登録されるため、fireEvent.drop/paste でネイティブイベントを投げれば
  // React 経由を待たず直接ハンドラに届く。

  it('画像ファイルのドロップで onUploadImage を呼び、成功時に画像を挿入する', async () => {
    const onChange = vi.fn();
    const onUploadImage = vi.fn().mockResolvedValue({ url: 'https://example.com/photo.png' });
    render(
      <RichEditor initialMarkdown="本文" onChangeMarkdown={onChange} onUploadImage={onUploadImage} />,
    );
    const content = screen.getByLabelText('本文（リッチエディタ）');
    const file = new File(['(binary)'], 'photo.png', { type: 'image/png' });

    withElementFromPoint(content, () =>
      fireEvent.drop(content, {
        ...dropCoords,
        dataTransfer: makeDataTransfer([file]),
      } as unknown as DragEventInit),
    );

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledWith(file));
    await waitFor(() => expect(content.querySelector('img')).not.toBeNull());
    expect(content.querySelector('img')).toHaveAttribute('src', 'https://example.com/photo.png');
  });

  it('画像以外のドロップ／ペーストでは onUploadImage を呼ばない', async () => {
    const onUploadImage = vi.fn();
    render(
      <RichEditor initialMarkdown="本文" onChangeMarkdown={vi.fn()} onUploadImage={onUploadImage} />,
    );
    const content = screen.getByLabelText('本文（リッチエディタ）');
    const textFile = new File(['plain text'], 'note.txt', { type: 'text/plain' });

    withElementFromPoint(content, () =>
      fireEvent.drop(content, {
        ...dropCoords,
        dataTransfer: makeDataTransfer([textFile]),
      } as unknown as DragEventInit),
    );
    withElementFromPoint(content, () =>
      fireEvent.paste(content, {
        clipboardData: makeDataTransfer([]),
      } as unknown as ClipboardEventInit),
    );

    // 非同期のアップロード起動が無いことを確認するため、マイクロタスクを一巡させてから検証する。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onUploadImage).not.toHaveBeenCalled();
  });

  it('アップロード失敗時に onError へ失敗メッセージを渡す', async () => {
    const onError = vi.fn();
    const onUploadImage = vi.fn().mockRejectedValue(new Error('サーバエラー'));
    render(
      <RichEditor
        initialMarkdown="本文"
        onChangeMarkdown={vi.fn()}
        onUploadImage={onUploadImage}
        onError={onError}
      />,
    );
    const content = screen.getByLabelText('本文（リッチエディタ）');
    const file = new File(['(binary)'], 'photo.png', { type: 'image/png' });

    withElementFromPoint(content, () =>
      fireEvent.drop(content, {
        ...dropCoords,
        dataTransfer: makeDataTransfer([file]),
      } as unknown as DragEventInit),
    );

    await waitFor(() => expect(onError).toHaveBeenCalledWith('サーバエラー'));
  });
});
