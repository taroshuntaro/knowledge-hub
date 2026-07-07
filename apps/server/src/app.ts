import { Hono } from 'hono';
import { errorHandler } from './middleware/error-handler';
import { originCheck } from './middleware/origin-check';
import { requestLogger } from './middleware/request-logger';
import { securityHeaders } from './middleware/security-headers';
import { adminRoutes } from './routes/admin';
import { articleRoutes } from './routes/articles';
import { authOidcRoutes } from './routes/auth-oidc';
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
import type { OidcAuth } from './services/oidc-service';
import type { AppEnv, Db, Mailer, SearchService, Storage } from './types';

export function buildApp(
  deps: {
    db: Db;
    config: Config;
    mailer: Mailer;
    storage: Storage;
    search: SearchService;
    oidcAuth: OidcAuth | null;
  },
) {
  return new Hono<AppEnv>()
    .use(async (c, next) => {
      c.set('db', deps.db);
      c.set('config', deps.config);
      c.set('mailer', deps.mailer);
      c.set('storage', deps.storage);
      c.set('search', deps.search);
      c.set('oidcAuth', deps.oidcAuth);
      await next();
    })
    .use(requestLogger)
    .use(securityHeaders({ hsts: deps.config.nodeEnv === 'production' }))
    .use(originCheck)
    .onError(errorHandler)
    .route('/healthz', healthRoutes)
    .route('/api/auth', authRoutes)
    .route('/api/auth/oidc', authOidcRoutes)
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
