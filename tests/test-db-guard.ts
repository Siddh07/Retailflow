import type { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * P9-05: Strict guard ensuring integration tests and database cleanups
 * can NEVER execute against a production database.
 */
export function assertTestDatabaseUrl(connectionString: string | undefined): void {
  if (!connectionString) {
    throw new Error('FATAL: Test DATABASE_URL is missing.');
  }

  const url = new URL(connectionString);

  // 1. Guard against non-local hostnames
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  // 2. Guard against non-test database names
  const isTestDb = url.pathname.endsWith('_test');

  if (!isLocal || !isTestDb) {
    throw new Error(
      `CRITICAL SECURITY ALERT: Refusing to run tests against '${url.hostname}${url.pathname}'! Tests only run on local databases ending in '_test'.`
    );
  }
}

/**
 * Extra defense: Query the database engine directly to verify its actual name.
 */
export async function assertConnectedToTestDatabase(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  const actualDbName = rows[0]?.name;

  if (!actualDbName || !actualDbName.endsWith('_test')) {
    throw new Error(
      `CRITICAL SECURITY ALERT: Connected DB '${actualDbName}' does not end in '_test'. Aborting test execution.`
    );
  }
}
