import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeroImage } from './HeroImage';

describe('HeroImage', () => {
  it('前景画像に alt と src を設定する（アクセシブルな img は 1 枚だけ）', () => {
    render(<HeroImage src="/api/uploads/up1" alt="記事タイトル" />);
    const img = screen.getByRole('img', { name: '記事タイトル' });
    expect(img).toHaveAttribute('src', '/api/uploads/up1');
    expect(img.className).toContain('object-contain');
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('ぼかし背景の img は同じ src を持ち aria-hidden で隠される', () => {
    const { container } = render(<HeroImage src="/api/uploads/up1" alt="記事タイトル" />);
    const hidden = container.querySelector('img[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
    expect(hidden).toHaveAttribute('src', '/api/uploads/up1');
    expect(hidden!.className).toContain('object-cover');
    expect(hidden!.className).toContain('blur');
  });
});
