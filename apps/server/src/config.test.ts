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
    expect(loadConfig({ ...base, PASSWORD_AUTH_ENABLED: 'false', OIDC_ISSUER: 'https://i', OIDC_CLIENT_ID: 'a', OIDC_CLIENT_SECRET: 'b' }).passwordAuthEnabled).toBe(false);
  });
  it('DATABASE_URL がないと throw する', () => {
    expect(() => loadConfig({})).toThrow();
  });
});

describe('loadConfig oidc', () => {
  const base = { DATABASE_URL: 'postgres://x' };
  it('3 変数が揃ったら oidc が有効になる', () => {
    const c = loadConfig({ ...base, OIDC_ISSUER: 'https://idp.example.com', OIDC_CLIENT_ID: 'kh', OIDC_CLIENT_SECRET: 's' });
    expect(c.oidc).toEqual({ issuer: 'https://idp.example.com', clientId: 'kh', clientSecret: 's', allowedEmailDomains: [] });
  });
  it('未設定なら oidc は undefined', () => {
    expect(loadConfig(base).oidc).toBeUndefined();
  });
  it('一部のみ設定は起動時エラー', () => {
    expect(() => loadConfig({ ...base, OIDC_ISSUER: 'https://idp.example.com' })).toThrow(/OIDC_/);
  });
  it('ドメイン制限はカンマ区切り・小文字化・空要素除去でパースされる', () => {
    const c = loadConfig({ ...base, OIDC_ISSUER: 'https://i', OIDC_CLIENT_ID: 'a', OIDC_CLIENT_SECRET: 'b', OIDC_ALLOWED_EMAIL_DOMAINS: 'Example.com, corp.co.jp,' });
    expect(c.oidc?.allowedEmailDomains).toEqual(['example.com', 'corp.co.jp']);
  });
  it('PASSWORD_AUTH_ENABLED=false かつ OIDC 無効は起動時エラー', () => {
    expect(() => loadConfig({ ...base, PASSWORD_AUTH_ENABLED: 'false' })).toThrow(/ログイン手段/);
  });
  it('3 変数すべて空文字列は未設定として扱われ oidc は undefined', () => {
    const c = loadConfig({ ...base, OIDC_ISSUER: '', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '' });
    expect(c.oidc).toBeUndefined();
  });
  it('一部が空文字列の場合もカスタムエラーになる', () => {
    expect(() =>
      loadConfig({ ...base, OIDC_ISSUER: 'https://idp.example.com', OIDC_CLIENT_ID: 'kh', OIDC_CLIENT_SECRET: '' }),
    ).toThrow(/すべて設定するか/);
  });
});

describe('loadConfig smtp auth', () => {
  const base = { DATABASE_URL: 'postgres://x' };
  it('SMTP_USER だけ設定されていると起動時エラー', () => {
    expect(() => loadConfig({ ...base, SMTP_USER: 'mailer' })).toThrow(/SMTP_USER \/ SMTP_PASSWORD/);
  });
  it('SMTP_USER と SMTP_PASSWORD が揃っていれば auth 設定として読める', () => {
    const c = loadConfig({ ...base, SMTP_USER: 'mailer', SMTP_PASSWORD: 'secret-pass', SMTP_SECURE: 'true' });
    expect(c.smtpUser).toBe('mailer');
    expect(c.smtpPassword).toBe('secret-pass');
    expect(c.smtpSecure).toBe(true);
  });
  it('SMTP 認証未設定なら従来どおり（auth なし・secure false）', () => {
    const c = loadConfig(base);
    expect(c.smtpUser).toBeUndefined();
    expect(c.smtpPassword).toBeUndefined();
    expect(c.smtpSecure).toBe(false);
  });
  it('空文字列は未設定として扱う（env テンプレートの ${VAR:-} 互換）', () => {
    const c = loadConfig({ ...base, SMTP_USER: '', SMTP_PASSWORD: '' });
    expect(c.smtpUser).toBeUndefined();
  });
});
