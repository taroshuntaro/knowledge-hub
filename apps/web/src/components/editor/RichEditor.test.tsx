import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RichEditor } from './RichEditor';

// jsdom の欠損 API スタブ（Range.getClientRects 等）は複数テストファイルで
// 必要なため src/test/setup.ts に集約済み。

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
