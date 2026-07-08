import { pino } from 'pino';
import { z } from 'zod';

// logger は多くのモジュールから import される singleton で、loadConfig() より前に
// 初期化されるため config 経由にはできない。ただし env の他の値と同様に、空文字は
// 既定値に正規化し、値は enum で検証して typo を pino 初期化任せにせず起動時に弾く。
const level = z
  .preprocess(
    (v) => (v === '' || v === undefined ? 'info' : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  )
  .parse(process.env.LOG_LEVEL);

export const logger = pino({ level });
