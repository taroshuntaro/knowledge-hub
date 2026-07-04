import { hc } from 'hono/client';
import type { AppType } from '@knowledge-hub/server/app';

export const api = hc<AppType>('/');
