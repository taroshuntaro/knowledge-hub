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

  it('未ブロックのキーだけならキー上限を超えても新規キーを受け付ける', () => {
    // 未ブロックのキーは常に退避対象になれるため、通常トラフィックは阻害されない
    const rl = new RateLimiter(5, 1000, 2);
    for (let i = 0; i < 10; i++) {
      expect(rl.consume(`k${i}`, 1000 + i)).toBe(true);
    }
  });

  it('ブロック中のキーは新規キーの流入で退避されない（フラッシュ攻撃対策）', () => {
    const rl = new RateLimiter(2, 1000, 2);
    expect(rl.consume('victim', 1000)).toBe(true);
    expect(rl.consume('victim', 1001)).toBe(true);
    expect(rl.consume('victim', 1002)).toBe(false); // 上限到達（ブロック中）
    // マップ上限まで新規キーを流入させても victim は退避されない
    expect(rl.consume('atk1', 1003)).toBe(true);
    expect(rl.consume('atk2', 1004)).toBe(true); // 未ブロックの atk1 が退避される
    // victim のブロックは維持される（フラッシュでリセットされない）
    expect(rl.consume('victim', 1005)).toBe(false);
  });

  it('全キーがブロック中なら新規キーは安全側で拒否する', () => {
    const rl = new RateLimiter(1, 1000, 2);
    expect(rl.consume('a', 1000)).toBe(true); // a ブロック
    expect(rl.consume('b', 1001)).toBe(true); // b ブロック（満杯）
    expect(rl.consume('c', 1002)).toBe(false); // 退避可能キーなし → 拒否
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
