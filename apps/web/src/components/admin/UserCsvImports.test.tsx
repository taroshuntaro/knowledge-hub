import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const postRegistrationsImport = vi.fn();
const postDeactivateImport = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    api: {
      admin: {
        users: {
          registrations: { import: { $post: (...args: unknown[]) => postRegistrationsImport(...args) } },
          deactivate: { import: { $post: (...args: unknown[]) => postDeactivateImport(...args) } },
        },
      },
    },
  },
}));

import { UserCsvImports } from './UserCsvImports';

function renderPage() {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <UserCsvImports />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

describe('UserCsvImports', () => {
  beforeEach(() => {
    postRegistrationsImport.mockReset();
    postDeactivateImport.mockReset();
  });

  it('登録 CSV の成功サマリを表示する', async () => {
    postRegistrationsImport.mockResolvedValue({
      ok: true,
      json: async () => ({ created: 3, createdDepartments: ['広報部'], createdPositions: [] }),
    });
    renderPage();
    const file = new File(['email,display_name,department,position,hire_year\n'], 'reg.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('登録 CSV ファイル'), file);
    await userEvent.click(screen.getByRole('button', { name: '登録 CSV をインポート' }));
    expect(await screen.findByText(/3 人を登録/)).toBeInTheDocument();
    expect(screen.getByText(/広報部/)).toBeInTheDocument();
  });

  it('無効化 CSV のエラーを行番号付きで表示する', async () => {
    postDeactivateImport.mockResolvedValue({
      ok: false,
      json: async () => ({
        code: 'CSV_IMPORT_FAILED',
        message: 'CSV にエラーがあります',
        details: [{ line: 2, email: 'x@example.com', message: 'このメールアドレスのユーザーがいません' }],
      }),
    });
    renderPage();
    const file = new File(['email\nx@example.com\n'], 'deact.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('無効化 CSV ファイル'), file);
    await userEvent.click(screen.getByRole('button', { name: '無効化 CSV をインポート' }));
    expect(await screen.findByText(/2 行目/)).toBeInTheDocument();
    expect(screen.getByText(/このメールアドレスのユーザーがいません/)).toBeInTheDocument();
  });

  it('無効化 CSV の成功で profiles キャッシュも invalidate する', async () => {
    postDeactivateImport.mockResolvedValue({ ok: true, json: async () => ({ deactivated: 2 }) });
    const { invalidateSpy } = renderPage();
    const file = new File(['email\nx@example.com\n'], 'deact.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('無効化 CSV ファイル'), file);
    await userEvent.click(screen.getByRole('button', { name: '無効化 CSV をインポート' }));

    expect(await screen.findByText(/2 人を無効化/)).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-users'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profiles'] });
  });
});
