import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUsers = vi.fn();

vi.mock('../api/client', () => ({
  api: { api: { users: { $get: (...args: unknown[]) => getUsers(...args) } } },
}));

import { MentionTextarea } from './MentionTextarea';

const candidates = [
  { id: '47395b74-5d75-487d-9ee6-481eb4c32ebc', displayName: '田中', avatarUrl: null },
  { id: '11111111-2222-4333-8444-555555555555', displayName: '佐藤', avatarUrl: null },
];

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <MentionTextarea value={value} onChange={setValue} aria-label="コメント" />
      <output data-testid="current">{value}</output>
    </>
  );
}

function renderBox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe('MentionTextarea', () => {
  beforeEach(() => {
    getUsers.mockReset();
    getUsers.mockResolvedValue({ ok: true, json: async () => candidates });
  });

  it('@ を打つと候補が表示される', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('textbox', { name: 'コメント' }), 'こんにちは @');
    expect(await screen.findByRole('option', { name: '田中' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '佐藤' })).toBeInTheDocument();
  });

  it('@ の後の入力で候補が絞り込まれる', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('textbox', { name: 'コメント' }), '@田');
    expect(await screen.findByRole('option', { name: '田中' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '佐藤' })).not.toBeInTheDocument();
  });

  it('候補を選択するとリンク記法が挿入される', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('textbox', { name: 'コメント' }), '@田');
    await userEvent.click(await screen.findByRole('option', { name: '田中' }));
    expect(screen.getByTestId('current')).toHaveTextContent(
      '[@田中](/users/47395b74-5d75-487d-9ee6-481eb4c32ebc)',
    );
  });

  it('@ がなければ候補は出ない', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('textbox', { name: 'コメント' }), '普通のテキスト');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape で候補が閉じる', async () => {
    renderBox();
    await userEvent.type(screen.getByRole('textbox', { name: 'コメント' }), '@');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
