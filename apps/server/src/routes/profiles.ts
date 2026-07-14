import { Hono } from 'hono';
import { requireAuth } from '../middleware/session';
import { listProfiles } from '../services/profile-service';
import type { AppEnv } from '../types';

export const profileRoutes = new Hono<AppEnv>()
  .use(requireAuth)
  .get('/', async (c) => c.json(await listProfiles(c.get('db'))));
