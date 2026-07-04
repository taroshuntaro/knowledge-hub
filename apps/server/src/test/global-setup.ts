import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  try {
    const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    } finally {
      await pool.end();
    }
    project.provide('dbUrl', container.getConnectionUri());
    return async () => {
      await container.stop();
    };
  } catch (error) {
    await container.stop();
    throw error;
  }
}
