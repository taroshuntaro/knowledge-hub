import type { Config } from './config';
import type { SessionUser } from '@knowledge-hub/shared';
import type { Db } from './db/client';
import type { Mailer } from './services/mailer';

export type AppEnv = {
  Variables: { db: Db; config: Config; mailer: Mailer; user: SessionUser };
};
export type { Db, Mailer };
