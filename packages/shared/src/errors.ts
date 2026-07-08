export const ERROR_CODES = [
  'VALIDATION', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
  'INVALID_CREDENTIALS', 'RATE_LIMITED', 'EMAIL_TAKEN', 'INVALID_TOKEN',
  'LAST_ADMIN', 'PASSWORD_AUTH_DISABLED', 'INTERNAL',
  'CONFLICT', 'CATEGORY_NOT_EMPTY',
  'OIDC_EMAIL', 'OIDC_DOMAIN', 'OIDC_INACTIVE', 'OIDC_UNAVAILABLE', 'OIDC_LINK_UNVERIFIED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ApiError = { code: ErrorCode; message: string; details?: unknown };
