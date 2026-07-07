import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger';
import { runNotify } from './notification-service';

describe('runNotify (best-effort)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fn が成功すればそのまま実行される', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await expect(runNotify('x', fn)).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('fn が reject しても throw せず logger.warn で記録する', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const err = new Error('boom');
    await expect(runNotify('reaction-added', () => Promise.reject(err))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err, notification: 'reaction-added' }),
      expect.any(String),
    );
  });
});
