import {
  claimSchema,
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
import { requirePasswordAuth } from '../middleware/password-auth';
import { validate } from '../middleware/validate';
import { loginWithPassword } from '../services/auth-service';
import { claimAccount } from '../services/claim-service';
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
// claim も login と同じ理由（総当たり防止）で email 単位に絞る。
export const claimLimiter = new RateLimiter(10, 15 * 60 * 1000);

// login / password-reset / claim 共通: email 単位（小文字化）で消費し、超過は 429。
function consumeOrThrow(limiter: RateLimiter, email: string): void {
  if (!limiter.consume(email.toLowerCase())) {
    throw new AppError(
      'RATE_LIMITED',
      '試行回数が上限に達しました。しばらくしてから再試行してください',
      429,
    );
  }
}

export const authRoutes = new Hono<AppEnv>()
  .get('/methods', (c) =>
    c.json({
      password: c.get('config').passwordAuthEnabled,
      oidc: c.get('oidcAuth') !== null,
    }),
  )
  .post('/login', requirePasswordAuth, validate('json', loginSchema), async (c) => {
    const config = c.get('config');
    const { email, password } = c.req.valid('json');
    consumeOrThrow(loginLimiter, email);

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
  .post('/password-reset/request', requirePasswordAuth, validate('json', passwordResetRequestSchema), async (c) => {
    const { email } = c.req.valid('json');
    consumeOrThrow(passwordResetLimiter, email);
    await requestPasswordReset(c.get('db'), c.get('mailer'), c.get('config'), email);
    return c.body(null, 204);
  })
  .post('/password-reset/confirm/:token', requirePasswordAuth, validate('json', passwordResetConfirmSchema), async (c) => {
    await resetPassword(c.get('db'), c.req.param('token'), c.req.valid('json').password);
    return c.body(null, 204);
  })
  .post('/claim', requirePasswordAuth, validate('json', claimSchema), async (c) => {
    const { email, code, password } = c.req.valid('json');
    consumeOrThrow(claimLimiter, email);

    const result = await claimAccount(c.get('db'), { email, code, password });
    if (!result) {
      throw new AppError(
        'CLAIM_INVALID',
        '登録コードまたはメールアドレスが正しくありません',
        400,
      );
    }

    setSessionCookie(c, result.sid, c.get('config'));
    return c.json(result.user);
  });
