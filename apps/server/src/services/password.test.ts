import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('正しいパスワードを検証できる', async () => {
    const stored = await hashPassword('my-secret-password');
    expect(await verifyPassword('my-secret-password', stored)).toBe(true);
  });

  it('誤ったパスワードを拒否する', async () => {
    const stored = await hashPassword('my-secret-password');
    expect(await verifyPassword('wrong-password-here', stored)).toBe(false);
  });

  it('同じ平文でもソルトによりハッシュが異なる', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('不正な形式の保存値は false を返す', async () => {
    expect(await verifyPassword('x', 'broken-value')).toBe(false);
  });

  it('非正規または不正な保存値は false を返す', async () => {
    const plain = 'my-secret-password';
    const stored = await hashPassword(plain);
    const [, salt, hash] = stored.split(':');
    const malformedValues = [
      ['空にデコードされる短い値', 'scrypt:A:A'],
      ['余分な component', `${stored}:extra`],
      ['salt の不正文字', `scrypt:${'*'.repeat(22)}:${hash}`],
      ['hash の不正文字', `scrypt:${salt}:${'*'.repeat(86)}`],
      ['padding 付き', `scrypt:${salt}=:${hash}`],
      ['短い salt', `scrypt:${Buffer.alloc(15).toString('base64url')}:${hash}`],
      ['短い hash', `scrypt:${salt}:${Buffer.alloc(63).toString('base64url')}`],
      ['長すぎる salt', `scrypt:${'A'.repeat(100_000)}:${hash}`],
      ['長すぎる hash', `scrypt:${salt}:${'A'.repeat(100_000)}`],
    ] as const;

    for (const [name, malformed] of malformedValues) {
      expect(await verifyPassword(plain, malformed), name).toBe(false);
    }
  });

  it('固定長でない保存値は split 前に拒否する', async () => {
    const colonHeavy = new String(':'.repeat(100_000));
    colonHeavy.split = () => {
      throw new Error('split should not be called');
    };

    await expect(
      verifyPassword('x', colonHeavy as unknown as string),
    ).resolves.toBe(false);
  });
});
