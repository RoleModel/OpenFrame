#!/bin/sh
# Vercel build for OpenFrame.
#
# Three steps, in this order: generate the Prisma client, apply migrations, build
# Next. The Dockerfile does the same generate-then-build, and the compose stack
# applies migrations separately; on Vercel there is no separate step to hook, so
# the build is where `migrate deploy` has to happen.
#
# `migrate deploy` only ever applies committed migrations — it never generates or
# resets one — so a build cannot invent a schema change. It is idempotent, which
# matters because previews and production both run it.
set -eu

echo "==> prisma generate"
bun run db:generate

# Neon (and any pooled Postgres) hands out two URLs, and migrations need the
# unpooled one: `migrate deploy` takes a session-level advisory lock, which a
# transaction-mode pooler does not hold across statements. The app itself is
# happier on the pooled URL, so when both are set they are used for different
# things rather than one being made to serve both.
if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
  echo "==> prisma migrate deploy (via MIGRATE_DATABASE_URL)"
  DATABASE_URL="$MIGRATE_DATABASE_URL" bun run db:migrate
else
  echo "==> prisma migrate deploy"
  bun run db:migrate
fi

echo "==> next build"
bun run build
