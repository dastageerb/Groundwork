import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
export function database(url) { return new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 30000, idle_in_transaction_session_timeout: 30000 }); }
export async function transaction(pool, action) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function migrate(pool) {
  await transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(762910)');
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const folder = new URL('../migrations/', import.meta.url);
    for (const file of (await readdir(folder)).filter(f => f.endsWith('.sql')).sort()) {
      if ((await db.query('SELECT name FROM schema_migrations WHERE name=$1', [file])).rowCount) continue;
      await db.query(await readFile(new URL(file, folder), 'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
    }
  });
}
