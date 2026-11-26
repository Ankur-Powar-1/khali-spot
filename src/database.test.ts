// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('runs migration and grant/RLS/RPC regressions in PostgreSQL', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema auth to authenticated, anon;
      create publication supabase_realtime;
    `)
    const migration = await readFile(new URL('../supabase/migrations/001_parking.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    const bulkMigration = await readFile(new URL('../supabase/migrations/002_mark_all_free.sql', import.meta.url), 'utf8')
    await db.exec(bulkMigration)
    const regressions = await readFile(new URL('../supabase/tests/access.sql', import.meta.url), 'utf8')
    await db.exec(regressions)
    const users = await db.query<{ count: number }>('select count(*)::integer from auth.users')
    expect(users.rows[0].count).toBe(0)
    const grants = await db.query<{ allowed: boolean }>(`select has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as allowed`)
    expect(grants.rows[0].allowed).toBe(false)
    const publication = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`)
    expect(publication.rows).toEqual([{ tablename: 'parking_revision' }])
  } finally {
    await db.close()
  }
}, 30000)
