import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getInitialTheme } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('applyTheme(dark) は .dark を付与し localStorage に保存する', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('applyTheme(light) は .dark を外す', () => {
    applyTheme('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('getInitialTheme は localStorage を最優先する', () => {
    localStorage.setItem('theme', 'dark');
    expect(getInitialTheme()).toBe('dark');
  });

  it('getInitialTheme は localStorage が無ければ prefers-color-scheme に従う', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    expect(getInitialTheme()).toBe('dark');
    vi.unstubAllGlobals();
  });
});
