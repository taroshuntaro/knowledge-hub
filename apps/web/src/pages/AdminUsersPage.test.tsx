import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const patchUser = vi.fn().mockResolvedValue({ ok: true });
const postImport = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ updated: 2, createdDepartments: ['人事部'], createdPositions: [] }),
});
const postUser = vi.fn();
const deleteUser = vi.fn();
const postUnclaim = vi.fn();
const postDeactivate = vi.fn();
const postRegistrationsImport = vi.fn();
const postDeactivateImport = vi.fn();
const getRegistrationCode = vi.fn().mockResolvedValue({ ok: true, json: async () => null });
const postRegistrationCode = vi.fn();
const deleteRegistrationCode = vi.fn();

const baseUsers = [
  { id: '1', email: 'a@example.com', displayName: '管理者', role: 'admin', authProvider: 'password', isActive: true, createdAt: '2026-07-04T00:00:00Z', avatarUrl: null, departmentId: 'd1', positionId: null, hireYear: 2015 },
  { id: '2', email: 'b@example.com', displayName: '太郎', role: 'member', authProvider: 'password', isActive: false, createdAt: '2026-07-04T00:00:00Z', avatarUrl: null, departmentId: null, positionId: null, hireYear: null },
  { id: '3', email: 'p@example.com', displayName: '未ログイン花子', role: 'member', authProvider: 'pending', isActive: true, createdAt: '2026-07-04T00:00:00Z', avatarUrl: null, departmentId: null, positionId: null, hireYear: null },
];

const getUsers = vi.fn().mockResolvedValue({ ok: true, json: async () => baseUsers });

vi.mock('../api/client', () => ({
  api: {
    api: {
      admin: {
        users: {
          $get: (...args: unknown[]) => getUsers(...args),
          $post: (...args: unknown[]) => postUser(...args),
          import: { $post: (...args: unknown[]) => postImport(...args) },
          registrations: { import: { $post: (...args: unknown[]) => postRegistrationsImport(...args) } },
          deactivate: {
            $post: (...args: unknown[]) => postDeactivate(...args),
            import: { $post: (...args: unknown[]) => postDeactivateImport(...args) },
          },
          ':id': {
            $patch: (...args: unknown[]) => patchUser(...args),
            $delete: (...args: unknown[]) => deleteUser(...args),
            unclaim: { $post: (...args: unknown[]) => postUnclaim(...args) },
          },
        },
        'registration-code': {
          $get: (...args: unknown[]) => getRegistrationCode(...args),
          $post: (...args: unknown[]) => postRegistrationCode(...args),
          $delete: (...args: unknown[]) => deleteRegistrationCode(...args),
        },
        departments: {
          $get: vi.fn().mockResolvedValue({
            ok: true, json: async () => [{ id: 'd1', name: '開発部', sortOrder: 0 }],
          }),
          $post: vi.fn(), ':id': { $patch: vi.fn(), $delete: vi.fn() },
        },
        positions: {
          $get: vi.fn().mockResolvedValue({
            ok: true, json: async () => [{ id: 'p1', name: '部長', sortOrder: 0 }],
          }),
          $post: vi.fn(), ':id': { $patch: vi.fn(), $delete: vi.fn() },
        },
      },
    },
  },
}));

import { AdminUsersPage } from './AdminUsersPage';

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminUsersPage />
    </QueryClientProvider>,
  );
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    getUsers.mockClear();
    postUser.mockReset();
    deleteUser.mockReset();
    postUnclaim.mockReset();
    postDeactivate.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('ユーザー一覧を表示し、無効ユーザーにはラベルが付く', async () => {
    renderPage();
    expect(await screen.findByText('a@example.com')).toBeInTheDocument();
    expect(await screen.findByText('無効')).toBeInTheDocument();

    const adminRow = screen.getByLabelText('管理者 を選択').closest('tr')!;
    const deactivateButton = within(adminRow).getByRole('button', { name: '無効化' });
    expect(deactivateButton).toHaveClass('border-destructive', 'text-destructive');

    const activateButton = await screen.findByRole('button', { name: '有効化' });
    expect(activateButton).not.toHaveClass('border-destructive');
  });

  it('所属セレクトの変更で PATCH が飛ぶ（未選択は null）', async () => {
    renderPage();
    await screen.findByText('a@example.com');
    const select = screen.getByLabelText('管理者 の所属');
    expect(select).toHaveValue('d1');
    await userEvent.selectOptions(select, '');
    expect(patchUser).toHaveBeenCalledWith({ param: { id: '1' }, json: { departmentId: null } });
  });

  it('CSV アップロードの成功サマリを表示する', async () => {
    renderPage();
    await screen.findByText('a@example.com');
    const file = new File(['email,department,position,hire_year\n'], 'org.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('CSV ファイル'), file);
    await userEvent.click(screen.getByRole('button', { name: 'インポート' }));
    expect(await screen.findByText(/2 人を更新/)).toBeInTheDocument();
    expect(screen.getByText(/人事部/)).toBeInTheDocument();
  });

  it('追加フォームで一覧が refetch される', async () => {
    postUser.mockResolvedValue({ ok: true, json: async () => ({ id: 'u9' }) });
    renderPage();
    await screen.findByText('a@example.com');
    const callsBefore = getUsers.mock.calls.length;

    await userEvent.type(screen.getByLabelText('メール'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('表示名'), '新人太郎');
    await userEvent.click(screen.getByRole('button', { name: '追加' }));

    expect(postUser).toHaveBeenCalledWith({
      json: { email: 'new@example.com', displayName: '新人太郎', departmentId: null, positionId: null, hireYear: null },
    });
    await vi.waitFor(() => expect(getUsers.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('チェックした複数ユーザーを確認の上まとめて無効化する', async () => {
    postDeactivate.mockResolvedValue({ ok: true, json: async () => ({ deactivated: 2 }) });
    renderPage();
    await screen.findByText('a@example.com');

    await userEvent.click(screen.getByLabelText('管理者 を選択'));
    await userEvent.click(screen.getByLabelText('未ログイン花子 を選択'));
    await userEvent.click(screen.getByRole('button', { name: '選択したユーザーを無効化' }));

    expect(window.confirm).toHaveBeenCalled();
    expect(postDeactivate).toHaveBeenCalledWith({ json: { userIds: ['1', '3'] } });
  });

  it('選択後に行を削除すると、一括無効化の送信対象から stale な id が除かれる', async () => {
    deleteUser.mockResolvedValue({ ok: true });
    postDeactivate.mockResolvedValue({ ok: true, json: async () => ({ deactivated: 1 }) });
    // 初回ロードは baseUsers、削除後の refetch では未ログイン花子（id: 3）が消えたリストを返す。
    getUsers.mockResolvedValueOnce({ ok: true, json: async () => baseUsers });
    getUsers.mockResolvedValueOnce({ ok: true, json: async () => baseUsers.filter((u) => u.id !== '3') });

    renderPage();
    await screen.findByText('a@example.com');

    await userEvent.click(screen.getByLabelText('管理者 を選択'));
    await userEvent.click(screen.getByLabelText('未ログイン花子 を選択'));

    await userEvent.click(screen.getByRole('button', { name: '未ログイン花子 を削除' }));
    await vi.waitFor(() => expect(screen.queryByText('未ログイン花子')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: '選択したユーザーを無効化' }));
    expect(postDeactivate).toHaveBeenCalledWith({ json: { userIds: ['1'] } });
  });

  it('一括無効化に成功すると選択がクリアされ一覧が refetch される', async () => {
    postDeactivate.mockResolvedValue({ ok: true, json: async () => ({ deactivated: 2 }) });
    renderPage();
    await screen.findByText('a@example.com');
    const callsBefore = getUsers.mock.calls.length;

    await userEvent.click(screen.getByLabelText('管理者 を選択'));
    await userEvent.click(screen.getByLabelText('未ログイン花子 を選択'));
    expect(screen.getByText('2 人選択中')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '選択したユーザーを無効化' }));

    await vi.waitFor(() => expect(getUsers.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(screen.queryByText(/人選択中/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('管理者 を選択')).not.toBeChecked();
  });

  it('pending 行には未ログインバッジと削除ボタン、クレーム済み行には未ログインに戻すボタンが出る', async () => {
    deleteUser.mockResolvedValue({ ok: true });
    postUnclaim.mockResolvedValue({ ok: true, json: async () => ({ ...baseUsers[0] }) });
    renderPage();
    await screen.findByText('a@example.com');

    expect(screen.getByText('未ログイン')).toBeInTheDocument();

    const pendingRow = screen.getByLabelText('未ログイン花子 を選択').closest('tr')!;
    expect(pendingRow).toHaveTextContent('削除');
    expect(pendingRow).not.toHaveTextContent('未ログインに戻す');

    const claimedRow = screen.getByLabelText('管理者 を選択').closest('tr')!;
    expect(claimedRow).toHaveTextContent('未ログインに戻す');
    expect(claimedRow).not.toHaveTextContent('削除');

    await userEvent.click(screen.getByRole('button', { name: '未ログイン花子 を削除' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith({ param: { id: '3' } });

    await userEvent.click(screen.getByRole('button', { name: '管理者 を未ログインに戻す' }));
    expect(postUnclaim).toHaveBeenCalledWith({ param: { id: '1' } });
  });

  it('未ログインに戻す確認メッセージに「管理者は member に戻ります」を含む', async () => {
    postUnclaim.mockResolvedValue({ ok: true, json: async () => ({ ...baseUsers[0] }) });
    renderPage();
    await screen.findByText('a@example.com');

    await userEvent.click(screen.getByRole('button', { name: '管理者 を未ログインに戻す' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('管理者は member に戻ります。'));
  });

  it('pending 行の管理者昇格ボタンは無効化される', async () => {
    renderPage();
    await screen.findByText('a@example.com');

    const pendingRow = screen.getByLabelText('未ログイン花子 を選択').closest('tr')!;
    const promoteButton = within(pendingRow).getByRole('button', { name: '管理者にする' });
    expect(promoteButton).toBeDisabled();
  });
});
