#!/bin/sh
# Vercel build for OpenFrame.
#
# generate → bootstrap the database → build Next.
#
# The database step is scripts/docker-db-bootstrap.ts, not `prisma migrate deploy`.
# That distinction matters and cost a broken deploy to learn:
#
# The migration history is not self-contained. Its earliest entry is
# `20260226110000_rate_limit_extras`, and `20260227000000_add_audio_asset_kind_and_provider`
# references a `VideoAssetKind` enum that no migration ever creates. So the
# migrations are incremental changes on top of a baseline that lives in
# schema.prisma rather than in prisma/migrations, and `migrate deploy` against an
# empty database fails partway with
#
#   ERROR: type "VideoAssetKind" does not exist   (SQLSTATE 42704)
#
# leaving a failed row in _prisma_migrations that blocks every later deploy with
# P3009 until somebody resolves it by hand.
#
# The project already knows all of this. docker-db-bootstrap.ts detects a fresh
# database, marks any failed migration rolled back, pushes the schema baseline,
# and then marks every migration applied so future deploys are ordinary
# `migrate deploy` runs. On a populated database it just migrates, and it refuses
# to guess if it finds a failure there. Reusing it means Vercel and Docker
# bootstrap identically instead of drifting.
#
# Set SKIP_DB_BOOTSTRAP=1 to build without touching the database.
set -eu

echo "==> prisma generate"
bun run db:generate

# Only production touches the schema.
#
# The Supabase integration sets the same DATABASE_URL for Production and Preview,
# so every preview build was doing schema work against the production database —
# and two builds doing it at once is how this went wrong:
#
#   P3018 column "multipart_upload_id" of relation "video_upload_sessions"
#         already exists
#
# One build had `db push` mid-flight while the other ran `migrate deploy` against
# the half-updated ledger. Neither command is at fault; running them concurrently
# is. A preview has no business migrating production anyway, so it does not.
#
# Point a preview at its own database and set SKIP_DB_BOOTSTRAP=0 to opt back in.
if [ "${SKIP_DB_BOOTSTRAP:-}" = "1" ]; then
  echo "==> skipping database bootstrap (SKIP_DB_BOOTSTRAP=1)"
elif [ -n "${VERCEL_ENV:-}" ] && [ "${VERCEL_ENV}" != "production" ] && [ "${SKIP_DB_BOOTSTRAP:-}" != "0" ]; then
  echo "==> skipping database bootstrap on a ${VERCEL_ENV} build (it shares production's database)"
else
  # Schema work needs the unpooled connection: `migrate deploy` takes a
  # session-level advisory lock that a transaction-mode pooler will not hold
  # across statements.
  DB_URL="${MIGRATE_DATABASE_URL:-${DATABASE_URL:-}}"
  if [ -z "$DB_URL" ]; then
    echo "!!! neither MIGRATE_DATABASE_URL nor DATABASE_URL is set" >&2
    exit 1
  fi

  # The CA, as a file.
  #
  # Managed Postgres often serves a chain rooted in the vendor's own CA rather
  # than a publicly-trusted one — Supabase serves "Supabase Root 2021 CA" — and
  # nothing in the system trust store matches it. lib/db.ts reads that root from
  # DATABASE_CA_CERT because an env var is the only thing a bundled serverless
  # function can rely on; Prisma and node-postgres both want a path, and both
  # read `sslrootcert` out of the connection string, so one URL serves both.
  #
  # Without this the failure is disguised: `P1001: Can't reach database server`,
  # which reads as a firewall or a wrong host and is really a rejected cert.
  if [ -n "${DATABASE_CA_CERT:-}" ]; then
    CA_FILE="$(mktemp)"
    printf '%s' "$DATABASE_CA_CERT" > "$CA_FILE"
    DB_URL="$(printf '%s' "$DB_URL" | sed 's/?.*$//')?sslmode=verify-full&sslrootcert=$CA_FILE"
    echo "==> database bootstrap (verifying against DATABASE_CA_CERT)"
  else
    echo "==> database bootstrap"
  fi

  DATABASE_URL="$DB_URL" bun run scripts/docker-db-bootstrap.ts
fi

echo "==> next build"
bun run build
