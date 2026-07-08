import {
  acceptInvitationSchema,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from '@knowledge-hub/shared';
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
import { acceptInvitation } from '../services/invitation-service';
import {
  requestPasswordReset,
  resetPassword,
} from '../services/password-reset-service';
import { RateLimiter } from '../services/rate-limiter';
import { deleteSession } from '../services/session-service';
import type { AppEnv } from '../types';

export const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);
// パスワードリセット要求はメール爆撃・リセットトークン量産の踏み台になりうるため
// email 単位で絞る（存在有無に関わらず 429 を返すため列挙攻撃には寄与しない）。
export const passwordResetLimiter = new RateLimiter(5, 15 * 60 * 1000);

export const authRoutes = new Hono<AppEnv>()
  .get('/methods', (c) =>
    c.json({
      password: c.get('config').passwordAuthEnabled,
      oidc: c.get('oidcAuth') !== null,
    }),
  )
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
  .get('/me', requireAuth, (c) => c.json(c.get('user')))
  .post(
    '/invitations/:token/accept',
    validate('json', acceptInvitationSchema),
    async (c) => {
      const { sid, user } = await acceptInvitation(
        c.get('db'),
        c.req.param('token'),
        c.req.valid('json'),
      );
      setSessionCookie(c, sid, c.get('config'));
      return c.json(user);
    },
  )
  .post('/password-reset/request', validate('json', passwordResetRequestSchema), async (c) => {
    if (!c.get('config').passwordAuthEnabled) {
      throw new AppError(
        'PASSWORD_AUTH_DISABLED',
        'パスワードログインは無効化されています',
        403,
      );
    }
    const { email } = c.req.valid('json');
    if (!passwordResetLimiter.consume(email.toLowerCase())) {
      throw new AppError(
        'RATE_LIMITED',
        '試行回数が上限に達しました。しばらくしてから再試行してください',
        429,
      );
    }
    await requestPasswordReset(c.get('db'), c.get('mailer'), c.get('config'), email);
    return c.body(null, 204);
  })
  .post('/password-reset/confirm/:token', validate('json', passwordResetConfirmSchema), async (c) => {
    if (!c.get('config').passwordAuthEnabled) {
      throw new AppError(
        'PASSWORD_AUTH_DISABLED',
        'パスワードログインは無効化されています',
        403,
      );
    }
    await resetPassword(c.get('db'), c.req.param('token'), c.req.valid('json').password);
    return c.body(null, 204);
  });
