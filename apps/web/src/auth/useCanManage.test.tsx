import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCanManage } from './useCanManage';

const me = { current: undefined as { id: string; role: string } | undefined };
vi.mock('./useMe', () => ({ useMe: () => ({ data: me.current }) }));

describe('useCanManage', () => {
  it('本人なら true', () => {
    me.current = { id: 'u1', role: 'member' };
    expect(renderHook(() => useCanManage('u1')).result.current).toBe(true);
  });
  it('admin なら他人の対象でも true', () => {
    me.current = { id: 'admin1', role: 'admin' };
    expect(renderHook(() => useCanManage('u1')).result.current).toBe(true);
  });
  it('他人の member は false', () => {
    me.current = { id: 'u2', role: 'member' };
    expect(renderHook(() => useCanManage('u1')).result.current).toBe(false);
  });
  it('me 未解決 / authorId 未定義は false', () => {
    me.current = undefined;
    expect(renderHook(() => useCanManage('u1')).result.current).toBe(false);
    me.current = { id: 'u1', role: 'member' };
    expect(renderHook(() => useCanManage(undefined)).result.current).toBe(false);
  });
});
