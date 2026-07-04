import type { Config } from './config';
import type { SessionUser } from '@knowledge-hub/shared';
import type { Db } from './db/client';

export type Mailer = {
  send(to: string, subject: string, text: string): Promise<void>;
};

export type AppEnv = {
  Variables: { db: Db; config: Config; mailer: Mailer; user: SessionUser };
};
export type { Db };
