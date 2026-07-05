import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { originCheck } from './middleware/origin-check';
import { adminRoutes } from './routes/admin';
import { articleRoutes } from './routes/articles';
import { authRoutes } from './routes/auth';
import { categoryRoutes } from './routes/categories';
import { healthRoutes } from './routes/health';
import { tagRoutes } from './routes/tags';
import { uploadRoutes } from './routes/uploads';
import { userRoutes } from './routes/users';
import type { Config } from './config';
import type { AppEnv, Db, Mailer, Storage } from './types';

export function buildApp(deps: { db: Db; config: Config; mailer: Mailer; storage: Storage }) {
  return new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('db', deps.db);
      c.set('config', deps.config);
      c.set('mailer', deps.mailer);
      c.set('storage', deps.storage);
      await next();
    })
    .use(async (c, next) => {
      await next();
      c.res.headers.set('X-Content-Type-Options', 'nosniff');
    })
    .use(originCheck)
    .onError(errorHandler)
    .route('/healthz', healthRoutes)
    .route('/api/auth', authRoutes)
    .route('/api/users', userRoutes)
    .route('/api/admin', adminRoutes)
    .route('/api/categories', categoryRoutes)
    .route('/api/tags', tagRoutes)
    .route('/api/articles', articleRoutes)
    .route('/api/uploads', uploadRoutes);
}

export type AppType = ReturnType<typeof buildApp>;
