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
});
