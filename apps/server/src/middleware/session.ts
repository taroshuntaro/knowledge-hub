import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Config } from '../config';
import { getSessionUser } from '../services/session-service';
import type { AppEnv } from '../types';

export function setSessionCookie(c: Context<AppEnv>, sid: string, config: Config): void {
  setCookie(c, 'sid', sid, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: config.nodeEnv === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, 'sid', { path: '/' });
}

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const sid = getCookie(c, 'sid');
  if (sid) {
    const user = await getSessionUser(c.get('db'), sid);
    if (user) {
      c.set('user', user);
      return next();
    }
  }

  return c.json({ code: 'UNAUTHORIZED', message: 'ログインが必要です' }, 401);
});
