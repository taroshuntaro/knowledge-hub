import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp } from '../app';
import type { Config } from '../config';
import * as schema from '../db/schema';
import type { Db, Mailer } from '../types';

export function testConfig(): Config {
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl: 'unused-in-tests',
    appUrl: 'http://localhost:5173',
    smtpHost: 'localhost',
    smtpPort: 1025,
    smtpFrom: 'test@example.com',
    passwordAuthEnabled: true,
  };
}

export type SentMail = { to: string; subject: string; text: string };

export function createFakeMailer(): Mailer & { sent: SentMail[] } {
  const sent: SentMail[] = [];
  return {
    sent,
    async send(to, subject, text) {
      sent.push({ to, subject, text });
    },
  };
}

export function createTestApp() {
  const pool = new pg.Pool({ connectionString: inject('dbUrl') });
  const db: Db = drizzle(pool, { schema });
  const mailer = createFakeMailer();
  const app = buildApp({ db, config: testConfig(), mailer });
  return { app, db, pool, mailer };
}

export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate table article_tags, article_revisions, articles, tags, categories, uploads, users, sessions, invitations, password_reset_tokens cascade`,
  );
}
