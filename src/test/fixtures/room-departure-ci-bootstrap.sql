-- Disposable CI-only Supabase role/auth shim for real room-departure SQL tests.
-- NEVER run on an application database. The workflow creates a fresh local
-- PostgreSQL service (tipoff_test) and rolls every test fixture back.
DO $$
BEGIN
  IF current_database() <> 'tipoff_test' THEN
    RAISE EXCEPTION 'Refusing room CI bootstrap outside tipoff_test';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Supabase creates this publication; local Postgres does not.
CREATE PUBLICATION supabase_realtime;
