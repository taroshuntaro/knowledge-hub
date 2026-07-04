import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('デフォルト値を補完して camelCase で返す', () => {
    const c = loadConfig(base);
    expect(c.port).toBe(3000);
    expect(c.appUrl).toBe('http://localhost:5173');
    expect(c.passwordAuthEnabled).toBe(true);
  });
  it('PASSWORD_AUTH_ENABLED=false を解釈する', () => {
    expect(loadConfig({ ...base, PASSWORD_AUTH_ENABLED: 'false' }).passwordAuthEnabled).toBe(false);
  });
  it('DATABASE_URL がないと throw する', () => {
    expect(() => loadConfig({})).toThrow();
  });
});
