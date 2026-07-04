import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:5173'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_FROM: z.string().default('knowledge-hub@example.com'),
  PASSWORD_AUTH_ENABLED: z.enum(['true', 'false']).default('true'),
});

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  appUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpFrom: string;
  passwordAuthEnabled: boolean;
};

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const e = envSchema.parse(source);
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    appUrl: e.APP_URL,
    smtpHost: e.SMTP_HOST,
    smtpPort: e.SMTP_PORT,
    smtpFrom: e.SMTP_FROM,
    passwordAuthEnabled: e.PASSWORD_AUTH_ENABLED === 'true',
  };
}
