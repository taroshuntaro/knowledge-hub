export const ERROR_CODES = [
  'VALIDATION', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
  'INVALID_CREDENTIALS', 'RATE_LIMITED', 'EMAIL_TAKEN', 'INVALID_TOKEN',
  'LAST_ADMIN', 'PASSWORD_AUTH_DISABLED', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ApiError = { code: ErrorCode; message: string; details?: unknown };
