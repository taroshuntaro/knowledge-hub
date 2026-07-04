import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { logger } from './logger';
import { createSmtpMailer } from './services/mailer';

const config = loadConfig();
const { db } = createDb(config.databaseUrl);
const app = buildApp({ db, config, mailer: createSmtpMailer(config) });

// 本番: ビルド済み SPA を配信（開発時は Vite dev server が担当するため 404 になるだけで無害）
app.use('*', serveStatic({ root: '../web/dist' }));
app.get('*', serveStatic({ path: '../web/dist/index.html' }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(`knowledge-hub server listening on :${info.port}`);
});
