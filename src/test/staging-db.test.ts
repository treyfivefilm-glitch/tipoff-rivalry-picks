// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isStagingDatabaseName, stagingDatabaseUrl } from './staging-db';

describe('staging database isolation', () => {
  it('ignores even a legacy production URL without explicit opt-in', () => {
    expect(stagingDatabaseUrl({ SUPABASE_DB_URL: 'postgres://localhost/production' })).toBeNull();
  });
  it('requires exactly true rather than a truthy opt-in', () => {
    expect(stagingDatabaseUrl({ RUN_STAGING_DB_TESTS: '1', STAGING_TEST_DB_URL: 'postgres://localhost/nba_test' })).toBeNull();
  });
  it('rejects opt-in without a designated URL', () => {
    expect(() => stagingDatabaseUrl({ RUN_STAGING_DB_TESTS: 'true' })).toThrow(/require/);
  });
  it('accepts a specifically named isolated test database', () => {
    expect(stagingDatabaseUrl({ RUN_STAGING_DB_TESTS: 'true', STAGING_TEST_DB_URL: 'postgres://localhost/nba_test' })).toBe('postgres://localhost/nba_test');
  });
  it.each(['postgres://localhost/postgres', 'postgres://localhost/nba_production_test',
    'postgres://prod.example.org/nba_test', 'postgres://db.example.supabase.co/nba_test',
    'postgres://app.lovable.cloud/nba_test', 'postgres://localhost/nba_test?options=unsafe',
    'https://localhost/nba_test', 'not-a-url'])('refuses unsafe targets without connecting: %s', (url) => {
    expect(() => stagingDatabaseUrl({ RUN_STAGING_DB_TESTS: 'true', STAGING_TEST_DB_URL: url })).toThrow();
  });
  it('also rejects a live database name reported by the connection', () => {
    expect(isStagingDatabaseName('postgres')).toBe(false);
    expect(isStagingDatabaseName('nba_live_test')).toBe(false);
    expect(isStagingDatabaseName('nba_staging')).toBe(true);
  });
});