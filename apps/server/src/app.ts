import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { originCheck } from './middleware/origin-check';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { userRoutes } from './routes/users';
import type { Config } from './config';
import type { AppEnv, Db, Mailer } from './types';

export function buildApp(deps: { db: Db; config: Config; mailer: Mailer }) {
  return new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('db', deps.db);
      c.set('config', deps.config);
      c.set('mailer', deps.mailer);
      await next();
    })
    .use(originCheck)
    .onError(errorHandler)
    .route('/healthz', healthRoutes)
    .route('/api/auth', authRoutes)
    .route('/api/users', userRoutes);
}

export type AppType = ReturnType<typeof buildApp>;
