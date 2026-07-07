import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { logger } from './logger';
import { createSmtpMailer } from './services/mailer';
import { createOidcAuth } from './services/oidc-service';
import { createBigmSearchService } from './services/search-service';
import { createS3Storage } from './services/storage';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const oidcAuth = config.oidc
  ? createOidcAuth(config.oidc, { allowInsecure: config.nodeEnv !== 'production' })
  : null;
const app = buildApp({
  db,
  config,
  mailer: createSmtpMailer(config),
  storage: createS3Storage(config),
  search: createBigmSearchService(),
  oidcAuth,
});

// 本番: ビルド済み SPA を配信（開発時は Vite dev server が担当するため 404 になるだけで無害）
app.use('*', serveStatic({ root: '../web/dist' }));
app.get('*', serveStatic({ path: '../web/dist/index.html' }));

// 検索は pg_bigm が無くても LIKE で動くが遅くなるため、欠如を運用者に知らせる。
// 起動時の DB 一時不達で serve() 前にクラッシュしないよう try/catch で保護する。
try {
  const bigm = await pool.query(`select 1 from pg_extension where extname = 'pg_bigm'`);
  if (bigm.rowCount === 0) {
    logger.warn('pg_bigm extension not installed: search runs without index acceleration');
  }
} catch (err) {
  logger.warn({ err }, 'could not verify pg_bigm extension at startup');
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(`knowledge-hub server listening on :${info.port}`);
});
