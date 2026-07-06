import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RichEditor } from './RichEditor';

// jsdom は ProseMirror が参照する一部の Range/Document API を未実装のまま呼ばせて
// 例外を投げるため、テスト実行時だけ最小のスタブで上書きする（実装コードには手を入れない）。
Range.prototype.getClientRects = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () =>
  ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
document.elementFromPoint = () => null;

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
});
