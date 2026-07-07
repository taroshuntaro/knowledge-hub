import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { originCheck } from './middleware/origin-check';
import { securityHeaders } from './middleware/security-headers';
import { adminRoutes } from './routes/admin';
import { articleRoutes } from './routes/articles';
import { authRoutes } from './routes/auth';
import { categoryRoutes } from './routes/categories';
import { articleCommentRoutes, commentRoutes } from './routes/comments';
import { articleEngagementRoutes, meRoutes } from './routes/engagement';
import { healthRoutes } from './routes/health';
import { notificationRoutes } from './routes/notifications';
import { searchRoutes } from './routes/search';
import { tagRoutes } from './routes/tags';
import { uploadRoutes } from './routes/uploads';
import { userRoutes } from './routes/users';
import type { Config } from './config';
import type { AppEnv, Db, Mailer, SearchService, Storage } from './types';

export function buildApp(
  deps: { db: Db; config: Config; mailer: Mailer; storage: Storage; search: SearchService },
) {
  return new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('db', deps.db);
      c.set('config', deps.config);
      c.set('mailer', deps.mailer);
      c.set('storage', deps.storage);
      c.set('search', deps.search);
      await next();
    })
    .use(securityHeaders)
    .use(originCheck)
    .onError(errorHandler)
    .route('/healthz', healthRoutes)
    .route('/api/auth', authRoutes)
    .route('/api/users', userRoutes)
    .route('/api/admin', adminRoutes)
    .route('/api/categories', categoryRoutes)
    .route('/api/tags', tagRoutes)
    .route('/api/articles', articleRoutes)
    .route('/api/articles', articleCommentRoutes)
    .route('/api/articles', articleEngagementRoutes)
    .route('/api/comments', commentRoutes)
    .route('/api/me', meRoutes)
    .route('/api/notifications', notificationRoutes)
    .route('/api/uploads', uploadRoutes)
    .route('/api/search', searchRoutes);
}

export type AppType = ReturnType<typeof buildApp>;
