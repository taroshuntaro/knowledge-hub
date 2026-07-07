import { z } from 'zod';

// 空文字列を undefined に正規化する（env テンプレートの ${VAR:-} で '' が入るため）
const emptyAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:5173'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_FROM: z.string().default('knowledge-hub@example.com'),
  SMTP_USER: emptyAsUndefined(z.string().min(1).optional()),
  SMTP_PASSWORD: emptyAsUndefined(z.string().min(1).optional()),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  PASSWORD_AUTH_ENABLED: z.enum(['true', 'false']).default('true'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('knowledge-hub'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  OIDC_ISSUER: emptyAsUndefined(z.string().url().optional()),
  OIDC_CLIENT_ID: emptyAsUndefined(z.string().min(1).optional()),
  OIDC_CLIENT_SECRET: emptyAsUndefined(z.string().min(1).optional()),
  OIDC_ALLOWED_EMAIL_DOMAINS: emptyAsUndefined(z.string().optional()),
});

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  appUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpFrom: string;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure: boolean;
  passwordAuthEnabled: boolean;
  s3Endpoint?: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3ForcePathStyle: boolean;
  oidc?: { issuer: string; clientId: string; clientSecret: string; allowedEmailDomains: string[] };
};

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const e = envSchema.parse(source);

  const oidcVars = [e.OIDC_ISSUER, e.OIDC_CLIENT_ID, e.OIDC_CLIENT_SECRET];
  const oidcSet = oidcVars.filter((v) => v !== undefined).length;
  if (oidcSet > 0 && oidcSet < 3) {
    throw new Error('OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET はすべて設定するか、すべて未設定にしてください');
  }
  const oidc =
    oidcSet === 3
      ? {
          issuer: e.OIDC_ISSUER!,
          clientId: e.OIDC_CLIENT_ID!,
          clientSecret: e.OIDC_CLIENT_SECRET!,
          allowedEmailDomains: (e.OIDC_ALLOWED_EMAIL_DOMAINS ?? '')
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter((s) => s.length > 0),
        }
      : undefined;
  if (e.PASSWORD_AUTH_ENABLED === 'false' && !oidc) {
    throw new Error('PASSWORD_AUTH_ENABLED=false には OIDC 設定が必要です（ログイン手段がなくなります）');
  }
  const smtpAuthSet = [e.SMTP_USER, e.SMTP_PASSWORD].filter((v) => v !== undefined).length;
  if (smtpAuthSet === 1) {
    throw new Error('SMTP_USER / SMTP_PASSWORD は両方設定するか、両方未設定にしてください');
  }
  // 本番で開発用既定値の S3 認証情報が混入したまま起動する事故を防ぐ（M-7）。
  if (e.NODE_ENV === 'production' && (e.S3_ACCESS_KEY_ID === 'minioadmin' || e.S3_SECRET_ACCESS_KEY === 'minioadmin')) {
    throw new Error('production では S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY の明示設定が必要です（開発用既定値では起動できません）');
  }

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    appUrl: e.APP_URL,
    smtpHost: e.SMTP_HOST,
    smtpPort: e.SMTP_PORT,
    smtpFrom: e.SMTP_FROM,
    smtpUser: e.SMTP_USER,
    smtpPassword: e.SMTP_PASSWORD,
    smtpSecure: e.SMTP_SECURE === 'true',
    passwordAuthEnabled: e.PASSWORD_AUTH_ENABLED === 'true',
    s3Endpoint: e.S3_ENDPOINT,
    s3Region: e.S3_REGION,
    s3Bucket: e.S3_BUCKET,
    s3AccessKeyId: e.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: e.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: e.S3_FORCE_PATH_STYLE === 'true',
    oidc,
  };
}
