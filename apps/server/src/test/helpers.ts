import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp } from '../app';
import type { Config } from '../config';
import * as schema from '../db/schema';
import type { Db, Mailer, Storage } from '../types';

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
    s3Region: 'us-east-1',
    s3Bucket: 'test',
    s3AccessKeyId: 'test',
    s3SecretAccessKey: 'test',
    s3ForcePathStyle: true,
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

export function createFakeStorage(): Storage & { store: Map<string, { body: Buffer; contentType: string }> } {
  const store = new Map<string, { body: Buffer; contentType: string }>();
  return {
    store,
    async put(key, body, contentType) {
      store.set(key, { body, contentType });
    },
    async get(key) {
      return store.get(key) ?? null;
    },
  };
}

export function createTestApp() {
  const pool = new pg.Pool({ connectionString: inject('dbUrl') });
  const db: Db = drizzle(pool, { schema });
  const mailer = createFakeMailer();
  const storage = createFakeStorage();
  const app = buildApp({ db, config: testConfig(), mailer, storage });
  return { app, db, pool, mailer, storage };
}

export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate table article_tags, article_revisions, articles, tags, categories, uploads, users, sessions, invitations, password_reset_tokens cascade`,
  );
}
