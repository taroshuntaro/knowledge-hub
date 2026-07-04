import type { ErrorCode } from '@knowledge-hub/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: ContentfulStatusCode = 400,
  ) {
    super(message);
  }
}
