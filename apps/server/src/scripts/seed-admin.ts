import { eq } from 'drizzle-orm';
import { loadConfig } from '../config';
import { createDb } from '../db/client';
import { users } from '../db/schema';
import { hashPassword } from '../services/password';

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const displayName = process.env.ADMIN_NAME ?? '管理者';

if (!email || !password) {
  console.error('ADMIN_EMAIL と ADMIN_PASSWORD を環境変数で指定してください');
  process.exit(1);
}
if (password.length < 12) {
  console.error('ADMIN_PASSWORD は 12 文字以上にしてください');
  process.exit(1);
}

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);

const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
if (existing) {
  console.log(`既に存在します: ${email}`);
} else {
  await db.insert(users).values({
    email,
    displayName,
    role: 'admin',
    authProvider: 'password',
    passwordHash: await hashPassword(password),
  });
  console.log(`admin を作成しました: ${email}`);
}
await pool.end();
