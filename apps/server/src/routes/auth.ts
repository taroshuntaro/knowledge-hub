import { loginSchema } from '@knowledge-hub/shared';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { AppError } from '../errors';
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
} from '../middleware/session';
import { validate } from '../middleware/validate';
import { loginWithPassword } from '../services/auth-service';
import { RateLimiter } from '../services/rate-limiter';
import { deleteSession } from '../services/session-service';
import type { AppEnv } from '../types';

export const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);

export const authRoutes = new Hono<AppEnv>()
  .post('/login', validate('json', loginSchema), async (c) => {
    const config = c.get('config');
    if (!config.passwordAuthEnabled) {
      throw new AppError(
        'PASSWORD_AUTH_DISABLED',
        'パスワードログインは無効化されています',
        403,
      );
    }

    const { email, password } = c.req.valid('json');
    if (!loginLimiter.consume(email.toLowerCase())) {
      throw new AppError(
        'RATE_LIMITED',
        '試行回数が上限に達しました。しばらくしてから再試行してください',
        429,
      );
    }

    const result = await loginWithPassword(c.get('db'), email, password);
    if (!result) {
      throw new AppError(
        'INVALID_CREDENTIALS',
        'メールアドレスまたはパスワードが正しくありません',
        401,
      );
    }

    setSessionCookie(c, result.sid, config);
    return c.json(result.user);
  })
  .post('/logout', async (c) => {
    const sid = getCookie(c, 'sid');
    if (sid) await deleteSession(c.get('db'), sid);
    clearSessionCookie(c);
    return c.body(null, 204);
  })
  .get('/me', requireAuth, (c) => c.json(c.get('user')));
