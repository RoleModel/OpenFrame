#!/bin/sh
# Vercel build for OpenFrame.
#
# Three steps: generate the Prisma client, apply migrations, build Next. The
# Dockerfile does the same generate-then-build; the compose stack applies
# migrations separately, and on Vercel there is no separate step to hook, so the
# build is where `migrate deploy` has to happen.
#
# `migrate deploy` only ever applies committed migrations — it never generates or
# resets one — so a build cannot invent a schema change. It is idempotent, which
# matters because previews and production both run it. Set SKIP_MIGRATIONS=1 to
# build without touching the database.
set -eu

echo "==> prisma generate"
bun run db:generate

if [ "${SKIP_MIGRATIONS:-}" = "1" ]; then
  echo "==> skipping prisma migrate deploy (SKIP_MIGRATIONS=1)"
else
  # Which connection to migrate over.
  #
  # A pooled Postgres hands out two URLs and migrations need the unpooled one:
  # `migrate deploy` takes a session-level advisory lock, which a transaction-mode
  # pooler does not hold across statements.
  MIGRATE_URL="${MIGRATE_DATABASE_URL:-${DATABASE_URL:-}}"
  if [ -z "$MIGRATE_URL" ]; then
    echo "!!! neither MIGRATE_DATABASE_URL nor DATABASE_URL is set" >&2
    exit 1
  fi

  # The CA, as a file.
  #
  # Managed Postgres often presents a chain rooted in the vendor's own CA rather
  # than a publicly-trusted one — Supabase serves "Supabase Root 2021 CA" — and
  # nothing in the system trust store matches it. The app reads that root from
  # DATABASE_CA_CERT (see lib/db.ts: an env var is the only thing a bundled
  # serverless function can rely on), but Prisma wants a path, so it is written
  # out here for the length of the build.
  #
  # This was worth an hour: without it `migrate deploy` fails with P1001 "can't
  # reach database server", which reads as a firewall or a wrong host and is
  # really a rejected certificate.
  if [ -n "${DATABASE_CA_CERT:-}" ]; then
    CA_FILE="$(mktemp)"
    printf '%s' "$DATABASE_CA_CERT" > "$CA_FILE"
    # Replace any sslmode the URL already carries rather than appending a second
    # one, and verify properly now that there is a root to verify against.
    MIGRATE_URL="$(printf '%s' "$MIGRATE_URL" | sed 's/?.*$//')?sslmode=verify-full&sslrootcert=$CA_FILE"
    echo "==> prisma migrate deploy (verifying against DATABASE_CA_CERT)"
  else
    echo "==> prisma migrate deploy"
  fi

  DATABASE_URL="$MIGRATE_URL" bun run db:migrate
fi

echo "==> next build"
bun run build
