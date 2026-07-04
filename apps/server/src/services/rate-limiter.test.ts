import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('上限までは許可し、超えたら拒否する', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.consume('k')).toBe(true);
    expect(rl.consume('k')).toBe(true);
    expect(rl.consume('k')).toBe(true);
    expect(rl.consume('k')).toBe(false);
  });

  it('ウィンドウ経過後は再び許可する', () => {
    const rl = new RateLimiter(1, 1000);
    const t0 = 1_000_000;
    expect(rl.consume('k', t0)).toBe(true);
    expect(rl.consume('k', t0 + 500)).toBe(false);
    expect(rl.consume('k', t0 + 1001)).toBe(true);
  });

  it('キーごとに独立してカウントする', () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.consume('a')).toBe(true);
    expect(rl.consume('b')).toBe(true);
  });

  it('キー上限では最も長く使われていないキーを破棄する', () => {
    const rl = new RateLimiter(1, 1000, 2);
    expect(rl.consume('a', 1000)).toBe(true);
    expect(rl.consume('b', 1001)).toBe(true);
    expect(rl.consume('a', 1002)).toBe(false);
    expect(rl.consume('c', 1003)).toBe(true);
    expect(rl.consume('b', 1003)).toBe(true);
  });

  it('キー上限では期限切れキーを回収して有効なキーを保持する', () => {
    const rl = new RateLimiter(1, 1000, 2);
    expect(rl.consume('expired', 1000)).toBe(true);
    expect(rl.consume('active', 1500)).toBe(true);
    expect(rl.consume('new', 2001)).toBe(true);
    expect(rl.consume('active', 2001)).toBe(false);
  });

  it.each([
    ['max', () => new RateLimiter(0, 1000)],
    ['windowMs', () => new RateLimiter(1, Number.POSITIVE_INFINITY)],
    ['maxKeys', () => new RateLimiter(1, 1000, Number.NaN)],
  ])('%s は正の有限値を要求する', (_name, create) => {
    expect(create).toThrow(RangeError);
  });
});
