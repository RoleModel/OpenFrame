// TLS configuration for the Postgres connection.
//
// Split out of lib/db.ts so it can be tested: importing db.ts constructs a
// Prisma client and a pool at module load, which a unit test has no business
// doing.

import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';

/**
 * The CA to verify the database's certificate against, if one is configured.
 *
 * Managed Postgres does not always present a publicly-trusted certificate.
 * Supabase, for one, serves a chain rooted in its own "Supabase Root 2021 CA",
 * so a connection that verifies properly needs that root supplied — there is
 * nothing in the system trust store to match it.
 *
 * DATABASE_CA_CERT holds the PEM itself, which is what works on a serverless
 * host: there is no reliable path to read a file from inside a bundled function,
 * and an env var reaches every runtime with no file-tracing configuration.
 * PGSSLROOTCERT takes a path instead, for a normal server or a local run.
 * Escaped newlines are accepted because dashboards mangle a pasted multi-line
 * value into literal backslash-n.
 *
 * Unset, this returns null and the connection string decides — the previous
 * behaviour, and the right one for a certificate a public CA already vouches for.
 */
export function resolveSslCa(): string | null {
  const inline = process.env.DATABASE_CA_CERT?.trim();
  if (inline) return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;

  const caPath = process.env.PGSSLROOTCERT?.trim();
  if (!caPath) return null;
  try {
    return readFileSync(caPath, 'utf8');
  } catch (err) {
    // Loud, not silent: a CA that was configured and could not be read must never
    // quietly downgrade to whatever the connection string happens to say.
    throw new Error(
      `PGSSLROOTCERT is set to "${caPath}" but it could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/**
 * Split a connection string into discrete fields.
 *
 * Needed because pg gives the connection string the last word — it parses it over
 * the config it was handed (`Object.assign({}, config, parse(connectionString))`
 * in pg's connection-parameters) — so an `ssl` option passed alongside a URL
 * carrying `sslmode=` is silently discarded. Handing pg the parts instead is the
 * only way an explicit CA survives.
 *
 * sslmode is deliberately dropped: a real CA check replaces it, and pg reads a
 * bare `sslmode=require` as full verification against the system store, which is
 * exactly the check that cannot pass against a private root.
 */
export function splitConnectionString(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...(database ? { database } : {}),
  };
}
