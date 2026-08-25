#!/usr/bin/env bash
#
# Push R2 credentials to the Vercel project without them passing through a
# terminal transcript, a shell history, or an argument list.
#
# Fill in a local file (.env* is already gitignored), then:
#
#   scripts/push-r2-env.sh .env.r2 production
#
# Each value is piped to `vercel env add` on stdin, so it never appears in
# `ps` output or history. An existing variable is removed first, because
# `vercel env add` appends rather than replaces and a duplicate name is
# resolved unpredictably at build time.
set -euo pipefail

FILE="${1:-.env.r2}"
ENVIRONMENT="${2:-production}"

[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }

# R2_ENDPOINT and R2_PRESIGN_ENDPOINT are optional: lib/r2.ts derives the
# endpoint from R2_ACCOUNT_ID when they are unset. The rest are required for
# an upload to work, and the CSP in proxy.ts is assembled from them.
# OPENFRAME_ENABLE_S3_VIDEO_UPLOADS is required, not a nicety: it defaults to
# false in lib/feature-flags.ts, so complete R2 credentials with the flag unset
# still leave uploads switched off — and the failure looks like bad credentials.
REQUIRED=(R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME OPENFRAME_ENABLE_S3_VIDEO_UPLOADS)
OPTIONAL=(R2_ENDPOINT R2_PRESIGN_ENDPOINT R2_PUBLIC_BASE_URL)

missing=()
for k in "${REQUIRED[@]}"; do
	grep -qE "^${k}=.+" "$FILE" || missing+=("$k")
done
if [ ${#missing[@]} -gt 0 ]; then
	echo "missing or empty in $FILE: ${missing[*]}" >&2
	exit 1
fi

# Uploads work without a public base URL; playback does not. getR2PublicObjectUrl
# falls back to the SigV4 endpoint, which a <video> tag cannot authenticate
# against — so every video 401s and the cause is nowhere near the symptom. Warn
# loudly rather than refuse: an upload-only config is a real intermediate state.
if ! grep -qE "^R2_PUBLIC_BASE_URL=.+" "$FILE"; then
	echo "  warning: R2_PUBLIC_BASE_URL is unset — uploads will work, playback will 401."
	echo "           Give the bucket a public read origin (R2 custom domain, or the"
	echo "           managed r2.dev domain), then set it and redeploy."
	echo
fi

for k in "${REQUIRED[@]}" "${OPTIONAL[@]}"; do
	line=$(grep -E "^${k}=" "$FILE" || true)
	[ -n "$line" ] || continue
	value="${line#*=}"
	value="${value%\"}"; value="${value#\"}"
	[ -n "$value" ] || continue
	vercel env rm "$k" "$ENVIRONMENT" --yes >/dev/null 2>&1 || true
	printf '%s' "$value" | vercel env add "$k" "$ENVIRONMENT" >/dev/null
	echo "  set $k"
done

echo
echo "Now redeploy — Vercel bakes env vars per deployment, so nothing above"
echo "takes effect until the next build:"
echo "  vercel deploy --prod"
echo
echo "To add just one variable later without re-supplying the rest:"
echo "  vercel env rm R2_PUBLIC_BASE_URL production --yes"
echo "  printf %s 'https://media.example.com' | vercel env add R2_PUBLIC_BASE_URL production"
