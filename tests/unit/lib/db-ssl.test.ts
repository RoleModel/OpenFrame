import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSslCa, splitConnectionString } from '@/lib/db-ssl';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';

describe('resolveSslCa', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_CA_CERT', '');
    vi.stubEnv('PGSSLROOTCERT', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null when nothing is configured, leaving the connection string in charge', () => {
    expect(resolveSslCa()).toBeNull();
  });

  it('reads the PEM straight out of DATABASE_CA_CERT', () => {
    vi.stubEnv('DATABASE_CA_CERT', PEM);
    expect(resolveSslCa()).toBe(PEM.trim());
  });

  // Dashboards routinely flatten a pasted multi-line value.
  it('unescapes literal backslash-n so a flattened paste still parses', () => {
    vi.stubEnv('DATABASE_CA_CERT', PEM.replace(/\n/g, '\\n'));
    const ca = resolveSslCa();
    expect(ca).toContain('-----BEGIN CERTIFICATE-----\n');
    expect(ca).not.toContain('\\n');
  });

  it('reads a file when given PGSSLROOTCERT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ca-'));
    const file = join(dir, 'root.crt');
    writeFileSync(file, PEM);
    vi.stubEnv('PGSSLROOTCERT', file);
    expect(resolveSslCa()).toBe(PEM);
  });

  it('prefers the inline PEM over a path', () => {
    vi.stubEnv('DATABASE_CA_CERT', PEM);
    vi.stubEnv('PGSSLROOTCERT', '/nonexistent/root.crt');
    expect(resolveSslCa()).toBe(PEM.trim());
  });

  // The important one: a configured-but-unreadable CA must not silently fall back
  // to whatever the connection string says, which would downgrade verification.
  it('throws rather than silently downgrading when the path cannot be read', () => {
    vi.stubEnv('PGSSLROOTCERT', '/nonexistent/root.crt');
    expect(() => resolveSslCa()).toThrow(/could not be read/);
  });
});

describe('splitConnectionString', () => {
  it('splits host, port, user, password and database', () => {
    expect(splitConnectionString('postgres://alice:s3cret@db.example.com:6543/appdb')).toEqual({
      host: 'db.example.com',
      port: 6543,
      user: 'alice',
      password: 's3cret',
      database: 'appdb',
    });
  });

  it('defaults the port to 5432', () => {
    expect(splitConnectionString('postgres://u:p@db.example.com/appdb').port).toBe(5432);
  });

  // Supabase's pooler user is `postgres.<project-ref>` and passwords are escaped.
  it('percent-decodes the user and password', () => {
    const cfg = splitConnectionString(
      'postgres://postgres.abc%2Ddef:p%40ss%2Fword@h:5432/postgres'
    );
    expect(cfg.user).toBe('postgres.abc-def');
    expect(cfg.password).toBe('p@ss/word');
  });

  // The whole point: sslmode must not survive, because pg reads a bare
  // `sslmode=require` as verification against the system store — the check that
  // cannot pass against a private root.
  it('drops sslmode and every other query parameter', () => {
    const cfg = splitConnectionString(
      'postgres://u:p@h:5432/postgres?sslmode=require&supa=base-pooler.x'
    );
    expect(cfg).not.toHaveProperty('ssl');
    expect(JSON.stringify(cfg)).not.toContain('sslmode');
  });

  it('omits the database when the path is empty', () => {
    expect(splitConnectionString('postgres://u:p@h:5432')).not.toHaveProperty('database');
  });
});
