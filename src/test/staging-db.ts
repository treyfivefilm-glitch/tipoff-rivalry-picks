/** Never fall back to the app, migration, or production connection variables. */
export function stagingDatabaseUrl(env: Record<string, string | undefined>): string | null {
  if (env['RUN_STAGING_DB_TESTS'] !== 'true') return null;
  const value = env['STAGING_TEST_DB_URL'];
  if (!value) throw new Error('Staging DB tests require STAGING_TEST_DB_URL.');
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error('Invalid staging database URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Staging database URL must use PostgreSQL.');
  }
  const name = decodeURIComponent(parsed.pathname.slice(1));
  const forbidden = /(^|[^a-z0-9])(prod|production|live)([^a-z0-9]|$)/i;
  if (!parsed.hostname || parsed.search || parsed.hash || forbidden.test(parsed.hostname) ||
      parsed.hostname.endsWith('.supabase.co') || parsed.hostname.endsWith('.supabase.com') ||
      parsed.hostname.endsWith('.lovable.cloud') || !isStagingDatabaseName(name)) {
    throw new Error('Refusing database tests: use a dedicated test/staging database, not a live/shared app database.');
  }
  return value;
}

export function isStagingDatabaseName(name: string): boolean {
  return /(^|[_-])(test|staging)([_-]|$)/i.test(name) &&
    !/(^|[_-])(prod|production|live)([_-]|$)/i.test(name);
}