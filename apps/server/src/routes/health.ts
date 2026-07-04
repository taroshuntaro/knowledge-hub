import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../types';

export const healthRoutes = new Hono<AppEnv>().get('/', async (c) => {
  await c.get('db').execute(sql`select 1`);
  return c.json({ status: 'ok' });
});
