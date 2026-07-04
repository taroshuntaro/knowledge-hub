import { zValidator } from '@hono/zod-validator';

export const validate = ((target: never, schema: never) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        { code: 'VALIDATION', message: '入力内容に誤りがあります', details: result.error.flatten() },
        400,
      );
    }
  })) as typeof zValidator;
