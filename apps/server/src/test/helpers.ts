import type { Config } from '../config';

export function testConfig(): Config {
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl: 'unused-in-tests',
    appUrl: 'http://localhost:5173',
    smtpHost: 'localhost',
    smtpPort: 1025,
    smtpFrom: 'test@example.com',
    passwordAuthEnabled: true,
  };
}
