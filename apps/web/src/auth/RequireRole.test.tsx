import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let me: { id: string; role: string } | undefined;
let isLoading = false;

vi.mock('./useMe', () => ({ useMe: () => ({ data: me, isLoading }) }));

import { RequireRole } from './RequireRole';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>ホーム</p>} />
        <Route path="/login" element={<p>ログイン</p>} />
        <Route
          path="/admin"
          element={
            <RequireRole role="admin">
              <p>管理画面</p>
            </RequireRole>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireRole', () => {
  beforeEach(() => {
    me = undefined;
    isLoading = false;
  });

  it('admin は子を表示する', () => {
    me = { id: 'u1', role: 'admin' };
    renderAt('/admin');
    expect(screen.getByText('管理画面')).toBeInTheDocument();
  });

  it('member はフィードへリダイレクトする', () => {
    me = { id: 'u2', role: 'member' };
    renderAt('/admin');
    expect(screen.queryByText('管理画面')).not.toBeInTheDocument();
    expect(screen.getByText('ホーム')).toBeInTheDocument();
  });

  it('未認証はログインへリダイレクトする', () => {
    me = undefined;
    renderAt('/admin');
    expect(screen.getByText('ログイン')).toBeInTheDocument();
  });
});
