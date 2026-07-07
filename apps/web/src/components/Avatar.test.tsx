import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('src がある場合は img を表示する', () => {
    render(<Avatar name="太郎" src="/api/uploads/u1" />);
    const img = screen.getByRole('img', { name: '太郎' });
    expect(img).toHaveAttribute('src', '/api/uploads/u1');
  });

  it('src が無い場合は name の頭文字を表示する', () => {
    render(<Avatar name="花子" src={null} />);
    expect(screen.getByText('花')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
