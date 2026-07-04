import type { Config } from './config';
import type { SessionUser } from '@knowledge-hub/shared';

// Task 5 で db/client.ts の Db に、Task 10 で services/mailer.ts の Mailer に差し替える
export type Db = unknown;
export type Mailer = unknown;

export type AppEnv = {
  Variables: { db: Db; config: Config; mailer: Mailer; user: SessionUser };
};
