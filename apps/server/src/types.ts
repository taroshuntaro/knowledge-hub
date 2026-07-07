import type { Config } from './config';
import type { SessionUser } from '@knowledge-hub/shared';
import type { Db } from './db/client';
import type { Mailer } from './services/mailer';
import type { OidcAuth } from './services/oidc-service';
import type { SearchService } from './services/search-service';
import type { Storage } from './services/storage';

export type AppEnv = {
  Variables: {
    db: Db; config: Config; mailer: Mailer; storage: Storage; search: SearchService; user: SessionUser;
    oidcAuth: OidcAuth | null;
  };
};
export type { Db, Mailer, Storage, SearchService };
