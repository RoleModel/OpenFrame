# Deploying OpenFrame to Vercel

This app is a good fit for Vercel, and that is not a given for a video tool. The
reason is the upload path: the browser PUTs straight to an S3-compatible bucket
against a presigned URL (`lib/client/r2-video-upload.ts`), with multipart for
large files, and only small JSON calls (`r2-init`, `r2-complete`) touch the Next
server. Vercel's request body limit never applies to a video. Nothing writes to
local disk, no route zips or transcodes on the server — the project download
returns a manifest and the client fetches the files — and there is exactly one
route pinned to the Node runtime (the Stripe webhook, which we leave off).

Three services, one each:

| What           | Service                                  | Why this one                                                                                    |
| -------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| App            | Vercel                                   | Next 16, no long-running work                                                                   |
| Database       | Neon (or Vercel Postgres, which is Neon) | Prisma 7 with `@prisma/adapter-pg` is already a pooling-friendly driver adapter                 |
| Object storage | Cloudflare R2                            | `R2_*` is a first-class backend here, and the rest of this toolkit already speaks R2 via rclone |

## 1. Database

Create a Postgres database and keep **both** connection strings:

- the **pooled** URL → `DATABASE_URL` (what the app runs on)
- the **unpooled / direct** URL → `MIGRATE_DATABASE_URL` (what migrations run on)

Two URLs because `prisma migrate deploy` takes a session-level advisory lock,
which a transaction-mode pooler does not hold across statements. `scripts/vercel-build.sh`
uses `MIGRATE_DATABASE_URL` for the migrate step when it is set and `DATABASE_URL`
for everything else. If your Postgres is not pooled, set only `DATABASE_URL`.

Set the Vercel project's function region to match the database region — a
cross-region hop shows up on every request. `vercel.json` pins `iad1` (US East);
change it if the database lives elsewhere.

### The certificate, which will cost you an hour if you skip it

Managed Postgres often presents a chain rooted in the vendor's own CA rather than
a publicly-trusted one. Supabase serves:

```
*.pooler.supabase.com  ←  Supabase Intermediate 2021 CA  ←  Supabase Root 2021 CA (self-signed)
```

Nothing in the system trust store matches that root, and both failures it causes
are disguised:

- `prisma migrate deploy` reports **`P1001: Can't reach database server`**, which
  reads as a firewall or a wrong host and is really a rejected certificate.
- `pg` 8.18 treats a bare `sslmode=require` as _full verification_ (libpq treats
  it as encrypt-without-verify; node-postgres deliberately differs and warns about
  it). So the running app fails too, not just the build.

Watch for a false negative while diagnosing this: with `NODE_TLS_REJECT_UNAUTHORIZED=0`
exported in a shell, the same connection succeeds and looks fine.

The fix is to supply the root, not to disable verification. Download it from the
project dashboard — Database Settings → SSL Configuration → `prod-ca-2021.crt` —
and set it as `DATABASE_CA_CERT` (the PEM itself, not a path):

```sh
vercel env add DATABASE_CA_CERT production --no-sensitive < prod-ca-2021.crt
```

`lib/db.ts` picks it up and connects with `rejectUnauthorized: true`. `PGSSLROOTCERT`
takes a path instead, for a normal server or a local run; an env var is used on
Vercel because a bundled serverless function has no dependable path to read from.

Note that the CA cannot be passed alongside the connection string: pg parses the
string _over_ the config it is given, so an `ssl` option next to a URL carrying
`sslmode=` is silently discarded. `lib/db-ssl.ts` splits the URL into fields for
exactly that reason, and drops `sslmode` on the way through.

The build materialises the same PEM to a temp file, because Prisma wants a path,
and migrates with `sslmode=verify-full&sslrootcert=…`.

To verify the root is the one you expect:

```sh
openssl x509 -in prod-ca-2021.crt -noout -subject -fingerprint -sha256
# subject=CN=Supabase Root 2021 CA, O=Supabase Inc
# SHA256 Fingerprint=80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
```

## 2. Bucket

Create an R2 bucket, then an R2 API token with object read/write on it.

**CORS is required, not optional.** The browser PUTs directly to the bucket and
reads back the `ETag` to complete a multipart upload; without CORS the upload
fails with a network error, and without `ETag` exposed it fails on completion.
The client says as much in its own error strings. Apply `scripts/r2-cors.json`
after replacing the origin with your domain:

```sh
# Cloudflare dashboard: R2 → your bucket → Settings → CORS policy → paste.
# Or with the AWS CLI pointed at R2:
aws s3api put-bucket-cors --bucket "$R2_BUCKET_NAME" \
  --cors-configuration file://scripts/r2-cors.json \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
```

For playback, give the bucket a public read origin (an R2 custom domain, or R2's
public bucket URL) and set it as `R2_PUBLIC_BASE_URL`. The CSP in `proxy.ts` is
built from the `R2_*` variables, so a bucket host that is not in the environment
is a bucket the browser is not allowed to talk to.

## 3. Environment

Set these on the Vercel project (Production, and Preview if you want previews to
work) **before the first deploy** — the build runs migrations, and the CSP is
assembled from these values.

### Required

```
DATABASE_URL=                 # pooled
MIGRATE_DATABASE_URL=         # unpooled/direct; omit if not pooled
NEXTAUTH_URL=https://your-domain
NEXTAUTH_SECRET=              # openssl rand -base64 32
NEXT_PUBLIC_APP_URL=https://your-domain
TRUSTED_PROXY_MODE=vercel
DATABASE_CA_CERT=             # the PEM, if the database uses a private CA (see above)
OPENFRAME_ENABLE_S3_VIDEO_UPLOADS=true
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=https://media.your-domain
ADMIN_EMAILS=                 # comma-separated
```

`TRUSTED_PROXY_MODE=vercel` is the mode to use here — **not** `nginx`. Both read
`x-forwarded-for`, but from opposite ends: nginx appends the peer so the client is
the last entry, while Vercel's edge prepends the client so it is the first.
Setting `nginx` on Vercel keys every rate limit on a Vercel proxy address, which
looks like it is working and is not. Left unset, every request resolves to
`127.0.0.1` and rate limits become per-process.

### Locking it down

A private review instance wants sign-up closed:

```
OPENFRAME_REQUIRE_INVITE_CODE=true
INVITE_CODE=
```

Email/password sign-in works with no third party (`Credentials` in `lib/auth.ts`).
`GOOGLE_*` / `GITHUB_*` are optional; SMTP settings are only needed for the mail
this instance sends.

### For the toolkit

`rm-share` and the Studio's OpenFrame panel authenticate with a bearer token:

```
OPENFRAME_API_TOKENS=tok_<random>:person@example.com
```

Comma-separate more pairs. The email must match a user on the instance. Then
point the Studio at the deployment instead of `http://localhost:3100` — Studio →
Share → OpenFrame url, with this token.

### Leave unset

`STRIPE_*` and `OPENFRAME_ENABLE_STRIPE` (billing — not our deployment),
`BUNNY_*` and `OPENFRAME_ENABLE_BUNNY_UPLOADS` (a second video backend; R2 takes
precedence and enabling both logs a warning), `TELEGRAM_BOT_TOKEN`,
`SELF_HOSTED_AUTO_CREATE_BUCKET` and `R2_PRESIGN_ENDPOINT` (both exist for the
Docker/MinIO stack, where the server and the browser reach storage at different
hostnames — on R2 they are the same host).

## 4. Deploy

```sh
vercel link          # pick the scope and project
vercel deploy --prod
```

`vercel.json` sets the framework, points the build at `scripts/vercel-build.sh`,
and enables git deploys from `master` only.

## 5. Check it actually works

The failure modes here are all storage and identity, so check those directly
rather than trusting a green build:

1. Sign in, create a project.
2. Upload a video **over 100 MB** — that exercises the multipart path, which is
   where CORS and `ETag` exposure fail. A small file can succeed while large
   files are broken.
3. Play it back — that exercises `R2_PUBLIC_BASE_URL` and the CSP.
4. Leave a comment, then reload — that exercises the database.
5. `curl -H "Authorization: Bearer $TOKEN" https://your-domain/api/projects` —
   that exercises `OPENFRAME_API_TOKENS`, which is what the toolkit uses.

## Licence

OpenFrame is FSL-1.1-ALv2, not open source. Internal use is permitted; a
"Competing Use" — making it available to third parties in a service that offers
substantially similar functionality — is not, and the author sells hosted
OpenFrame commercially. A deployment used to review our own work with our own
clients and a deployment offered to clients as a product are different things
under that licence, and which one this is is a business decision, not a
deployment setting. It converts to Apache-2.0 on the second anniversary of the
release. Read `LICENCE`; ask a person before this becomes a client-facing
offering.
