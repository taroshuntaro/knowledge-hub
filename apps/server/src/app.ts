import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { originCheck } from './middleware/origin-check';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { categoryRoutes } from './routes/categories';
import { healthRoutes } from './routes/health';
import { tagRoutes } from './routes/tags';
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
    .route('/api/users', userRoutes)
    .route('/api/admin', adminRoutes)
    .route('/api/categories', categoryRoutes)
    .route('/api/tags', tagRoutes);
}

export type AppType = ReturnType<typeof buildApp>;
