import { createMiddleware } from 'hono/factory';
import { AppError } from '../errors';
import type { AppEnv } from '../types';

// パスワード認証系エンドポイント（ログイン・リセット要求/確定）に適用するガード。
// SSO 専用運用（PASSWORD_AUTH_ENABLED=false）では 403 を返す。各ハンドラに同じ
// チェックを直書きせず、この 1 箇所に集約する。
export const requirePasswordAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('config').passwordAuthEnabled) {
    throw new AppError('PASSWORD_AUTH_DISABLED', 'パスワードログインは無効化されています', 403);
  }
  await next();
});
