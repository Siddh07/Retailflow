import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl } from './test-db-guard.js';

describe('P9-05 — Test Database Safety Guard', () => {
  it('allows safe local test database URLs', () => {
    expect(() =>
      assertTestDatabaseUrl('postgresql://user:pass@localhost:5433/retailflow_test?schema=public')
    ).not.toThrow();

    expect(() =>
      assertTestDatabaseUrl('postgresql://user:pass@127.0.0.1:5432/my_app_test')
    ).not.toThrow();
  });

  it('rejects remote production database URLs', () => {
    expect(() =>
      assertTestDatabaseUrl('postgresql://user:pass@production-db.c123.rds.amazonaws.com:5432/retailflow_test')
    ).toThrow(/CRITICAL SECURITY ALERT/);

    expect(() =>
      assertTestDatabaseUrl('postgresql://user:pass@db.retailflow.com:5432/retailflow_test')
    ).toThrow(/CRITICAL SECURITY ALERT/);
  });

  it('rejects local non-test database names', () => {
    expect(() =>
      assertTestDatabaseUrl('postgresql://user:pass@localhost:5432/retailflow_prod')
    ).toThrow(/CRITICAL SECURITY ALERT/);

    expect(() =>
      assertTestDatabaseUrl('postgresql://user:pass@localhost:5432/retailflow_dev')
    ).toThrow(/CRITICAL SECURITY ALERT/);
  });

  it('rejects missing database URL', () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(/Test DATABASE_URL is missing/);
  });
});
