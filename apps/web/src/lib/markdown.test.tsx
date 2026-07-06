import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

describe('Markdown', () => {
  it('見出しと本文をレンダリングする', () => {
    render(<Markdown source={'# タイトル\n\n本文テキスト'} />);
    expect(screen.getByRole('heading', { name: 'タイトル' })).toBeInTheDocument();
    expect(screen.getByText('本文テキスト')).toBeInTheDocument();
  });

  it('生の script は描画されない（サニタイズ）', () => {
    render(<Markdown source={'<script>alert(1)</script>安全'} />);
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/安全/)).toBeInTheDocument();
  });

  it('コードブロックがハイライトされる（hljs クラスが付く）', () => {
    render(<Markdown source={'```ts\nconst x = 1;\n```'} />);
    expect(document.querySelector('code.language-ts')).not.toBeNull();
    expect(document.querySelector('.hljs-keyword')).not.toBeNull();
  });

  it('タスクリストが無効化チェックボックスとして描画される', () => {
    render(<Markdown source={'- [x] done\n- [ ] todo'} />);
    const boxes = document.querySelectorAll('input[type="checkbox"][disabled]');
    expect(boxes).toHaveLength(2);
  });

  it('input は checkbox 以外を許可しない（XSS 面の回帰確認）', () => {
    render(<Markdown source={'<input type="text" value="x">'} />);
    expect(document.querySelector('input[type="text"]')).toBeNull();
  });
});
