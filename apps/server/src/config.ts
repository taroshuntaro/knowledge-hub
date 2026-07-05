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
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('knowledge-hub'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
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
  s3Endpoint?: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3ForcePathStyle: boolean;
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
    s3Endpoint: e.S3_ENDPOINT,
    s3Region: e.S3_REGION,
    s3Bucket: e.S3_BUCKET,
    s3AccessKeyId: e.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: e.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: e.S3_FORCE_PATH_STYLE === 'true',
  };
}
